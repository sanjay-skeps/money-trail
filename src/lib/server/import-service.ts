import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accounts, categories, categoryRules, transactions } from "@/lib/db/schema";
import { duplicateKey, flagDuplicates, matchCategoryRule } from "@/lib/statement-import";
import { evaluateBudgetAlerts, evaluateSmartAlerts } from "@/lib/server/ledger-service";

export const ruleInput = z.object({ pattern: z.string().trim().min(2).max(100), type: z.enum(["expense", "income"]), category: z.string().trim().min(1).max(60) });

const importRow = z.object({
  date: z.iso.date(), description: z.string().trim().min(1).max(160), merchant: z.string().trim().max(120).nullable().optional(),
  amount: z.number().positive().finite().max(999999999999), type: z.enum(["expense", "income"]), category: z.string().trim().min(1).max(60).optional(),
});
export const importInput = z.object({
  mode: z.enum(["preview", "commit"]),
  accountId: z.uuid().nullable().optional(),
  paymentMethod: z.enum(["cash", "upi", "card", "bank", "wallet"]).default("bank"),
  rows: z.array(importRow).min(1).max(1000),
});
type ImportRow = z.infer<typeof importRow>;

const fallbackCategory = { expense: "Other", income: "Other income" } as const;

export async function listRules(userId: string) {
  return db.select().from(categoryRules).where(eq(categoryRules.userId, userId)).orderBy(asc(categoryRules.createdAt), asc(categoryRules.id));
}

export async function createRule(userId: string, input: z.infer<typeof ruleInput>) {
  const [category] = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, userId), eq(categories.name, input.category), eq(categories.type, input.type))).limit(1);
  if (!category) return null;
  const [rule] = await db.insert(categoryRules).values({ ...input, userId }).returning();
  return rule;
}

export async function deleteRule(userId: string, id: string) {
  const [deleted] = await db.delete(categoryRules).where(and(eq(categoryRules.id, id), eq(categoryRules.userId, userId))).returning({ id: categoryRules.id });
  return deleted ?? null;
}

async function categorize(userId: string, rows: ImportRow[]) {
  const rules = await listRules(userId);
  return rows.map((row) => ({ ...row, category: row.category ?? matchCategoryRule(rules, row) ?? fallbackCategory[row.type] }));
}

/** Applies rules and flags rows that already exist in the ledger (same date, type, amount, and description). */
export async function previewImport(userId: string, rows: ImportRow[]) {
  const dates = rows.map((row) => row.date).sort();
  const existing = await db.select({ date: transactions.transactionDate, type: transactions.type, amount: transactions.amount, description: transactions.description }).from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.transactionDate, dates[0]), lte(transactions.transactionDate, dates[dates.length - 1])));
  const duplicates = flagDuplicates(rows.map(duplicateKey), existing.map(duplicateKey));
  return (await categorize(userId, rows)).map((row, index) => ({ ...row, duplicate: duplicates[index] }));
}

/** Inserts the rows the user kept after previewing; duplicates are not re-checked because the user chose them. */
export async function commitImport(userId: string, input: z.infer<typeof importInput>) {
  if (input.accountId) {
    const [account] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)));
    if (!account) return { error: "account" as const };
  }
  const owned = await db.select({ id: categories.id, name: categories.name, type: categories.type, parentId: categories.parentId, createdAt: categories.createdAt }).from(categories).where(eq(categories.userId, userId));
  // Same preference as saveTransaction: top-level categories first, then the oldest.
  owned.sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const categoryIds = new Map<string, string>();
  for (const category of owned) if (!categoryIds.has(`${category.type}|${category.name}`)) categoryIds.set(`${category.type}|${category.name}`, category.id);
  const values = (await categorize(userId, input.rows)).map((row) => ({
    userId, type: row.type, description: row.description, merchant: row.merchant || null,
    categoryId: categoryIds.get(`${row.type}|${row.category}`) ?? null, category: row.category,
    amount: row.amount.toFixed(2), transactionDate: row.date, paymentMethod: input.paymentMethod, accountId: input.accountId ?? null,
  }));
  await db.transaction(async (tx) => {
    for (let start = 0; start < values.length; start += 500) await tx.insert(transactions).values(values.slice(start, start + 500));
  });
  await evaluateBudgetAlerts(userId);
  await evaluateSmartAlerts(userId);
  return { imported: values.length };
}
