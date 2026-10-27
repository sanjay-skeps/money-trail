import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { currencies } from "@/lib/currency";
import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { deleteTransaction, saveTransaction } from "@/lib/server/ledger-service";

export const expenseInput = z.object({
  description: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(60),
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  spentOn: z.iso.date(),
});
export async function addExpense(userId: string, input: z.infer<typeof expenseInput>) {
  const result = await saveTransaction(userId, { ...input, type: "expense", transactionDate: input.spentOn, paymentMethod: "cash", accountId: null, toAccountId: null, merchant: null, notes: null, tags: undefined, splits: undefined });
  if ("error" in result) throw new Error(result.error);
  return { ...result.transaction, spentOn: result.transaction.transactionDate };
}
export async function editExpense(userId: string, expenseId: string, input: z.infer<typeof expenseInput>) {
  const [existing] = await db.select().from(transactions).where(and(eq(transactions.id, expenseId), eq(transactions.userId, userId)));
  if (!existing) return null;
  const result = await saveTransaction(userId, { ...input, type: "expense", transactionDate: input.spentOn, paymentMethod: existing.paymentMethod as "cash" | "upi" | "card" | "bank" | "wallet", accountId: existing.accountId, toAccountId: null, merchant: existing.merchant, notes: existing.notes, tags: undefined, splits: undefined }, expenseId);
  if ("error" in result) return null;
  return { ...result.transaction, spentOn: result.transaction.transactionDate };
}
export async function removeExpense(userId: string, expenseId: string) { return deleteTransaction(userId, expenseId); }
export async function setUserCurrency(userId: string, currency: string) {
  if (!currencies.includes(currency as (typeof currencies)[number])) return false;
  await db.update(users).set({ currency }).where(eq(users.id, userId));
  return true;
}
