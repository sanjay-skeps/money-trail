import "server-only";
import { and, desc, eq, exists, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accounts, alerts, budgets, categories, receipts, tags, transactionSplits, transactionTags, transactions } from "@/lib/db/schema";
import { deleteReceipt } from "@/lib/server/receipt-storage";
import { formatMoney } from "@/lib/currency";
import { accountBalance, previousMonthStart, splitsMatchAmount } from "@/lib/finance";
import { users } from "@/lib/db/schema";

const splitSchema = z.array(z.object({ label: z.string().trim().min(1).max(100), amount: z.coerce.number().positive(), isMine: z.boolean().default(false) })).max(30).optional();
export const transactionInput = z.object({
  type: z.enum(["expense", "income", "transfer"]).default("expense"),
  description: z.string().trim().min(1).max(160), merchant: z.string().trim().max(120).optional().nullable(),
  category: z.string().trim().min(1).max(60).default("Other"), categoryId: z.uuid().optional().nullable(), amount: z.coerce.number().positive().finite().max(999999999999),
  transactionDate: z.iso.date(), notes: z.string().max(2000).optional().nullable(),
  paymentMethod: z.enum(["cash", "upi", "card", "bank", "wallet"]).default("cash"),
  accountId: z.uuid().optional().nullable(), toAccountId: z.uuid().optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(), splits: splitSchema,
});
export type TransactionInput = z.infer<typeof transactionInput>;

async function ownedAccount(userId: string, id?: string | null) {
  if (!id) return null;
  const [account] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId)));
  return account ?? null;
}

export async function listTransactions(userId: string, filters: { q?: string; type?: string; category?: string; from?: string; to?: string; limit?: number; offset?: number }) {
  const clauses = [eq(transactions.userId, userId)];
  if (filters.type && ["expense", "income", "transfer"].includes(filters.type)) clauses.push(eq(transactions.type, filters.type));
  if (filters.category) clauses.push(eq(transactions.category, filters.category));
  if (filters.from && /^\d{4}-\d\d-\d\d$/.test(filters.from)) clauses.push(gte(transactions.transactionDate, filters.from));
  if (filters.to && /^\d{4}-\d\d-\d\d$/.test(filters.to)) { const end = new Date(`${filters.to}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1); clauses.push(lt(transactions.transactionDate, end.toISOString().slice(0, 10))); }
  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim().replace(/^#/, "")}%`;
    clauses.push(or(ilike(transactions.description, pattern), ilike(transactions.merchant, pattern), ilike(transactions.notes, pattern), exists(db.select({ id: transactionTags.tagId }).from(transactionTags).innerJoin(tags, eq(tags.id, transactionTags.tagId)).where(and(eq(transactionTags.transactionId, transactions.id), eq(tags.userId, userId), ilike(tags.name, pattern)))))!);
  }
  const rows = await db.select().from(transactions).where(and(...clauses)).orderBy(desc(transactions.transactionDate), desc(transactions.createdAt), desc(transactions.id)).limit(filters.limit ?? 300).offset(filters.offset ?? 0);
  const ids = rows.map((row) => row.id);
  if (!ids.length) return rows;
  const [splitRows, tagRows] = await Promise.all([
    db.select().from(transactionSplits).where(inArray(transactionSplits.transactionId, ids)),
    db.select({ transactionId: transactionTags.transactionId, name: tags.name }).from(transactionTags).innerJoin(tags, eq(tags.id, transactionTags.tagId)).where(inArray(transactionTags.transactionId, ids)),
  ]);
  return rows.map((row) => ({ ...row, splits: splitRows.filter((part) => part.transactionId === row.id), tags: tagRows.filter((tag) => tag.transactionId === row.id).map((tag) => tag.name) }));
}

export async function saveTransaction(userId: string, input: TransactionInput, id?: string) {
  if (input.accountId && !(await ownedAccount(userId, input.accountId))) return { error: "account" as const };
  if (input.type === "transfer" && (!input.toAccountId || !input.accountId || input.accountId === input.toAccountId)) return { error: "transfer" as const };
  if (input.toAccountId && !(await ownedAccount(userId, input.toAccountId))) return { error: "account" as const };
  if (input.splits?.length && !splitsMatchAmount(input.splits, input.amount)) return { error: "split" as const };
  if (id && input.splits === undefined) {
    // Omitted splits are kept on edit, so they must still add up to the (possibly new) amount.
    const existingSplits = await db.select({ amount: transactionSplits.amount }).from(transactionSplits).innerJoin(transactions, eq(transactions.id, transactionSplits.transactionId)).where(and(eq(transactionSplits.transactionId, id), eq(transactions.userId, userId)));
    if (existingSplits.length && !splitsMatchAmount(existingSplits, input.amount)) return { error: "split" as const };
  }

  let category: { id: string; name: string } | undefined;
  if (input.categoryId) {
    // An explicit id is exact, and its stored name wins over any name sent alongside it.
    [category] = await db.select({ id: categories.id, name: categories.name }).from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.userId, userId), input.type === "transfer" ? undefined : eq(categories.type, input.type)));
    if (!category) return { error: "category" as const };
  } else {
    // Callers that only know a name: names are only unique per parent, so match the type and prefer a top-level category, then the oldest.
    [category] = await db.select({ id: categories.id, name: categories.name }).from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.name, input.category), input.type === "transfer" ? undefined : eq(categories.type, input.type)))
      .orderBy(sql`${categories.parentId} is not null`, categories.createdAt, categories.id).limit(1);
  }
  const saved = await db.transaction(async (tx) => {
    const values = {
      userId, type: input.type, description: input.description, merchant: input.merchant || null,
      categoryId: category?.id ?? null, category: category?.name ?? input.category, amount: input.amount.toFixed(2),
      transactionDate: input.transactionDate, notes: input.notes || null, paymentMethod: input.paymentMethod,
      accountId: input.accountId || null, toAccountId: input.type === "transfer" ? input.toAccountId! : null,
      updatedAt: new Date(),
    };
    let item;
    if (id) {
      const [owned] = await tx.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
      if (!owned) return null;
      [item] = await tx.update(transactions).set(values).where(eq(transactions.id, id)).returning();
      if (input.splits !== undefined) await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
      if (input.tags !== undefined) await tx.delete(transactionTags).where(eq(transactionTags.transactionId, id));
    } else [item] = await tx.insert(transactions).values(values).returning();
    if (!item) return null;
    if (input.splits?.length) await tx.insert(transactionSplits).values(input.splits.map((part) => ({ transactionId: item.id, label: part.label, amount: part.amount.toFixed(2), isMine: part.isMine })));
    if (input.tags?.length) {
      const names = [...new Set(input.tags.map((tag) => tag.toLowerCase().replace(/^#/, "")))];
      await tx.insert(tags).values(names.map((name) => ({ userId, name }))).onConflictDoNothing();
      const ownedNames = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, userId));
      const wanted = new Set(names);
      const chosen = ownedNames.filter((tag) => wanted.has(tag.name));
      if (chosen.length) await tx.insert(transactionTags).values(chosen.map((tag) => ({ transactionId: item.id, tagId: tag.id }))).onConflictDoNothing();
    }
    return item;
  });
  if (!saved) return { error: "not-found" as const };
  await evaluateBudgetAlerts(userId);
  await evaluateSmartAlerts(userId, saved);
  return { transaction: saved };
}

export async function deleteTransaction(userId: string, id: string) {
  const attached = await db.select({ objectKey: receipts.objectKey }).from(receipts).where(and(eq(receipts.transactionId, id), eq(receipts.userId, userId)));
  for (const receipt of attached) await deleteReceipt(receipt.objectKey);
  const [item] = await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId))).returning({ id: transactions.id });
  return !!item;
}

export async function createAccount(userId: string, input: { name: string; type: string; kind: string; openingBalance: number }) {
  const [account] = await db.insert(accounts).values({ ...input, userId, openingBalance: input.openingBalance.toFixed(2) }).returning();
  return account;
}

export async function listAccounts(userId: string) {
  const rows = await db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.createdAt);
  const movements = await db.select({ accountId: transactions.accountId, toAccountId: transactions.toAccountId, type: transactions.type, amount: transactions.amount }).from(transactions).where(eq(transactions.userId, userId));
  return rows.map((account) => ({ ...account, balance: accountBalance(account, movements) }));
}

export async function createCategory(userId: string, input: { name: string; type: string; parentId?: string | null }) {
  if (input.parentId) {
    const [parent] = await db.select({ id: categories.id, type: categories.type }).from(categories).where(and(eq(categories.id, input.parentId), eq(categories.userId, userId)));
    if (!parent || parent.type !== input.type) return null;
  }
  const [row] = await db.insert(categories).values({ ...input, userId, name: input.name.trim() }).returning();
  return row;
}

export async function listCategories(userId: string) {
  return db.select().from(categories).where(eq(categories.userId, userId)).orderBy(categories.name);
}

export async function getBudgetProgress(userId: string, budget: typeof budgets.$inferSelect) {
  const now = new Date();
  let start: Date, end: Date;
  if (budget.period === "weekly") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
    end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  } else if (budget.period === "monthly") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  } else {
    start = new Date(`${budget.startDate}T00:00:00Z`);
    const inclusiveEnd = budget.endDate ? new Date(`${budget.endDate}T00:00:00Z`) : now;
    end = new Date(inclusiveEnd); end.setUTCDate(end.getUTCDate() + 1);
  }
  const startText = start.toISOString().slice(0, 10), endText = end.toISOString().slice(0, 10);
  const filter = (from: string, to: string) => and(eq(transactions.userId, userId), eq(transactions.type, "expense"), gte(transactions.transactionDate, from), lt(transactions.transactionDate, to), budget.categoryId ? eq(transactions.categoryId, budget.categoryId) : sql`true`);
  const rows = await db.select({ id: transactions.id, amount: transactions.amount }).from(transactions).where(filter(startText, endText));
  const splitRows = rows.length ? await db.select().from(transactionSplits).where(inArray(transactionSplits.transactionId, rows.map((row) => row.id))) : [];
  const mine = new Map<string, number[]>(), hasSplits = new Set<string>();
  for (const part of splitRows) { hasSplits.add(part.transactionId); if (part.isMine) mine.set(part.transactionId, [...(mine.get(part.transactionId) ?? []), Number(part.amount)]); }
  const personalAmount = (row: (typeof rows)[number]) => hasSplits.has(row.id) ? (mine.get(row.id) ?? []).reduce((sum, part) => sum + part, 0) : Number(row.amount);
  const spent = rows.reduce((sum, row) => sum + personalAmount(row), 0);
  let rolloverAmount = 0;
  if (budget.rollover) {
    const duration = end.getTime() - start.getTime();
    const previousStart = budget.period === "monthly" ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)) : budget.period === "weekly" ? new Date(start.getTime() - 7 * 86400000) : new Date(start.getTime() - duration);
    const before = await db.select({ id: transactions.id, amount: transactions.amount }).from(transactions).where(filter(previousStart.toISOString().slice(0, 10), startText));
    const beforeSplits = before.length ? await db.select().from(transactionSplits).where(inArray(transactionSplits.transactionId, before.map((row) => row.id))) : [];
    const beforeMine = new Map<string, number[]>(), beforeHasSplits = new Set<string>();
    for (const part of beforeSplits) { beforeHasSplits.add(part.transactionId); if (part.isMine) beforeMine.set(part.transactionId, [...(beforeMine.get(part.transactionId) ?? []), Number(part.amount)]); }
    const priorSpent = before.reduce((sum, row) => sum + (beforeHasSplits.has(row.id) ? (beforeMine.get(row.id) ?? []).reduce((a, b) => a + b, 0) : Number(row.amount)), 0);
    rolloverAmount = Math.max(0, Number(budget.amount) - priorSpent);
  }
  const available = Number(budget.amount) + rolloverAmount;
  return { ...budget, spent, rolloverAmount, available, remaining: available - spent, utilization: available ? Math.floor(spent / available * 100) : 0 };
}

export async function evaluateBudgetAlerts(userId: string) {
  const budgetsForUser = await db.select().from(budgets).where(and(eq(budgets.userId, userId), eq(budgets.active, true)));
  for (const budget of budgetsForUser) {
    const progress = await getBudgetProgress(userId, budget);
    const percent = progress.utilization, today = new Date().toISOString().slice(0, 10);
    if (percent >= budget.alertAt) await db.insert(alerts).values({ userId, key: `budget:${budget.id}:${progress.available}:${budget.alertAt}:${today.slice(0, 7)}`, kind: "budget", message: `${budget.name} budget is ${percent}% used.` }).onConflictDoNothing();
  }
}

export async function evaluateSmartAlerts(userId: string, latest?: typeof transactions.$inferSelect) {
  const dateNow = new Date(), today = dateNow.toISOString().slice(0, 10), month = today.slice(0, 7), currentStart = `${month}-01`;
  dateNow.setUTCDate(dateNow.getUTCDate() + 1);
  const tomorrow = dateNow.toISOString().slice(0, 10);
  if (latest?.type === "expense") {
    const older = await db.select({ amount: transactions.amount }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.type, "expense"), lt(transactions.transactionDate, latest.transactionDate), gte(transactions.transactionDate, new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))));
    const avg = older.length ? older.reduce((sum, item) => sum + Number(item.amount), 0) / older.length : 0;
    if (avg > 0 && Number(latest.amount) > avg * 3) await db.insert(alerts).values({ userId, key: `unusual:${latest.id}`, kind: "unusual-spending", message: `${latest.description} is unusually large compared with your recent expenses.` }).onConflictDoNothing();
  }
  const prevStart = previousMonthStart(currentStart);
  const prevEnd = currentStart;
  const [currentRows, priorRows] = await Promise.all([
    db.select({ category: transactions.category, amount: sql<string>`sum(${transactions.amount})` }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.type, "expense"), gte(transactions.transactionDate, currentStart), lt(transactions.transactionDate, tomorrow))).groupBy(transactions.category),
    db.select({ category: transactions.category, amount: sql<string>`sum(${transactions.amount})` }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.type, "expense"), gte(transactions.transactionDate, prevStart), lt(transactions.transactionDate, prevEnd))).groupBy(transactions.category),
  ]);
  const prior = new Map(priorRows.map((row) => [row.category, Number(row.amount)]));
  for (const row of currentRows) {
    const old = prior.get(row.category) ?? 0, now = Number(row.amount);
    if (old > 0 && now >= old * 1.23) await db.insert(alerts).values({ userId, key: `trend:${row.category}:${month}`, kind: "spending-trend", message: `Your ${row.category.toLowerCase()} spending is ${Math.round((now / old - 1) * 100)}% higher than last month.` }).onConflictDoNothing();
  }
  const monthRows = await db.select({ type: transactions.type, amount: transactions.amount }).from(transactions).where(and(eq(transactions.userId, userId), gte(transactions.transactionDate, currentStart), lt(transactions.transactionDate, tomorrow)));
  const monthIncome = monthRows.filter((row) => row.type === "income").reduce((sum, row) => sum + Number(row.amount), 0);
  const monthSpent = monthRows.filter((row) => row.type === "expense").reduce((sum, row) => sum + Number(row.amount), 0);
  const daysElapsed = Math.max(1, new Date().getUTCDate()), averagePerDay = monthSpent / daysElapsed;
  const runway = monthIncome - monthSpent - averagePerDay * 10;
  const [profile] = await db.select({ currency: users.currency }).from(users).where(eq(users.id, userId));
  if (runway > 0 && profile) await db.insert(alerts).values({ userId, key: `runway:${month}`, kind: "spending-runway", message: `At your current spending pace, about ${formatMoney(runway, profile.currency)} is left for the next 10 days.` }).onConflictDoUpdate({ target: [alerts.userId, alerts.key], set: { message: `At your current spending pace, about ${formatMoney(runway, profile.currency)} is left for the next 10 days.` } });
  const owned = await listAccounts(userId);
  for (const account of owned) if (account.kind === "asset" && account.balance < 0) await db.insert(alerts).values({ userId, key: `low-balance:${account.id}:${today.slice(0, 7)}`, kind: "low-balance", message: `${account.name} has a negative balance of ${account.balance}.` }).onConflictDoNothing();
}
