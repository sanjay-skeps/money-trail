import "server-only";
import { compare, hash } from "bcryptjs";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts, alerts, budgets, categories, categoryRules, expenses, receipts, recurring,
  recurringOccurrences, refreshSessions, tags, transactionSplits,
  transactionTags, transactions, users,
} from "@/lib/db/schema";
import { deleteReceipt } from "@/lib/server/receipt-storage";
import { listTransactions } from "@/lib/server/ledger-service";
import { toCsv } from "@/lib/csv";

export async function updateProfileName(userId: string, name: string) {
  const [user] = await db.update(users)
    .set({ name })
    .where(eq(users.id, userId))
    .returning({ id: users.id, name: users.name, email: users.email, currency: users.currency });
  return user ?? null;
}

export async function changeProfilePassword(userId: string, currentPassword: string, newPassword: string) {
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !(await compare(currentPassword, user.passwordHash))) return false;

  const passwordHash = await hash(newPassword, 12);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await tx.update(refreshSessions).set({ revokedAt: new Date() }).where(and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt)));
  });
  return true;
}

export async function deleteProfileAccount(userId: string) {
  const ownedReceipts = await db.select({ objectKey: receipts.objectKey }).from(receipts).where(eq(receipts.userId, userId));
  await Promise.all(ownedReceipts.map(({ objectKey }) => deleteReceipt(objectKey)));
  const [deleted] = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return Boolean(deleted);
}

export async function getUserDataExport(userId: string) {
  const [userRows, accountRows, categoryRows, transactionRows, tagRows, receiptRows, budgetRows, recurringRows, alertRows, legacyExpenseRows, ruleRows] = await Promise.all([
    db.select({ name: users.name, email: users.email, currency: users.currency, createdAt: users.createdAt }).from(users).where(eq(users.id, userId)),
    db.select().from(accounts).where(eq(accounts.userId, userId)),
    db.select().from(categories).where(eq(categories.userId, userId)),
    db.select().from(transactions).where(eq(transactions.userId, userId)),
    db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.userId, userId)),
    db.select({ id: receipts.id, transactionId: receipts.transactionId, contentType: receipts.contentType, originalName: receipts.originalName, createdAt: receipts.createdAt }).from(receipts).where(eq(receipts.userId, userId)),
    db.select().from(budgets).where(eq(budgets.userId, userId)),
    db.select().from(recurring).where(eq(recurring.userId, userId)),
    db.select().from(alerts).where(eq(alerts.userId, userId)),
    db.select().from(expenses).where(eq(expenses.userId, userId)),
    db.select().from(categoryRules).where(eq(categoryRules.userId, userId)),
  ]);
  const transactionIds = transactionRows.map((transaction) => transaction.id);
  const recurringIds = recurringRows.map((schedule) => schedule.id);
  const [splitRows, transactionTagRows, occurrenceRows] = await Promise.all([
    transactionIds.length ? db.select().from(transactionSplits).where(inArray(transactionSplits.transactionId, transactionIds)) : Promise.resolve([]),
    transactionIds.length ? db.select({ transactionId: transactionTags.transactionId, tagId: transactionTags.tagId }).from(transactionTags).innerJoin(tags, and(eq(tags.id, transactionTags.tagId), eq(tags.userId, userId))).where(inArray(transactionTags.transactionId, transactionIds)) : Promise.resolve([]),
    recurringIds.length ? db.select().from(recurringOccurrences).where(inArray(recurringOccurrences.recurringId, recurringIds)) : Promise.resolve([]),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: userRows[0] ?? null,
    accounts: accountRows,
    categories: categoryRows,
    categoryRules: ruleRows,
    transactions: transactionRows,
    transactionSplits: splitRows,
    transactionTags: transactionTagRows,
    tags: tagRows,
    receipts: receiptRows,
    budgets: budgetRows,
    recurring: recurringRows,
    recurringOccurrences: occurrenceRows,
    alerts: alertRows,
    legacyExpenses: legacyExpenseRows,
  };
}

type CsvTransaction = typeof transactions.$inferSelect & { tags: string[]; splits: { label: string; amount: string; isMine: boolean }[] };

function transactionsCsv(rows: CsvTransaction[], accountRows: { id: string; name: string }[], currency: string) {
  const accountName = (id: string | null) => accountRows.find((account) => account.id === id)?.name ?? "";
  return toCsv([
    ["Date", "Type", "Description", "Category", "Amount", "Currency", "Account", "Destination account", "Payment method", "Merchant", "Notes", "Tags", "Splits"],
    ...rows.map((transaction) => [
      transaction.transactionDate,
      transaction.type,
      transaction.description,
      transaction.category,
      transaction.amount,
      currency,
      accountName(transaction.accountId),
      accountName(transaction.toAccountId),
      transaction.paymentMethod,
      transaction.merchant ?? "",
      transaction.notes ?? "",
      transaction.tags.join(", "),
      transaction.splits.map((split) => `${split.label}: ${split.amount}${split.isMine ? " (mine)" : ""}`).join(", "),
    ]),
  ]);
}

export async function getCsvTransactionExport(userId: string) {
  const data = await getUserDataExport(userId);
  const tagNameById = new Map(data.tags.map((tag) => [tag.id, tag.name] as const));
  const rows = data.transactions.map((transaction) => ({
    ...transaction,
    tags: data.transactionTags.filter((relation) => relation.transactionId === transaction.id).map((relation) => tagNameById.get(relation.tagId)).filter((name): name is string => !!name),
    splits: data.transactionSplits.filter((split) => split.transactionId === transaction.id),
  }));
  return transactionsCsv(rows, data.accounts, data.profile?.currency ?? "INR");
}

/** CSV of the transactions matching the dashboard filters. */
export async function getFilteredCsvExport(userId: string, filters: { q?: string; type?: string; category?: string; from?: string; to?: string }) {
  const [rows, accountRows, [profile]] = await Promise.all([
    listTransactions(userId, { ...filters, limit: 50000 }),
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.userId, userId)),
    db.select({ currency: users.currency }).from(users).where(eq(users.id, userId)),
  ]);
  return transactionsCsv(rows.map((row) => ({ tags: [], splits: [], ...row })), accountRows, profile?.currency ?? "INR");
}
