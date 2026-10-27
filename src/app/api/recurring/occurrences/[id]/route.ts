import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { db } from "@/lib/db";
import { categories, recurring, recurringOccurrences, transactions } from "@/lib/db/schema";
import { isSameOriginRequest } from "@/lib/server/http";
import { nextDueDate, type Cadence } from "@/lib/finance";
import { evaluateBudgetAlerts, evaluateSmartAlerts } from "@/lib/server/ledger-service";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh(); if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const occurrenceId = z.uuid().safeParse((await params).id); if (!occurrenceId.success) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const action = request.nextUrl.searchParams.get("action"); if (action !== "confirm" && action !== "skip") return NextResponse.json({ error: "action" }, { status: 400 });
  const [row] = await db.select({ occurrence: recurringOccurrences, schedule: recurring }).from(recurringOccurrences).innerJoin(recurring, eq(recurring.id, recurringOccurrences.recurringId)).where(and(eq(recurringOccurrences.id, occurrenceId.data), eq(recurring.userId, user.id), eq(recurringOccurrences.status, "pending")));
  if (!row) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const result = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(recurringOccurrences).set({ status: action === "confirm" ? "confirmed" : "skipped" }).where(and(eq(recurringOccurrences.id, row.occurrence.id), eq(recurringOccurrences.status, "pending"))).returning({ id: recurringOccurrences.id });
    if (!claimed) return null;
    let transactionId: string | null = null;
    if (action === "confirm") {
      const [category] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, user.id), eq(categories.name, row.schedule.category), eq(categories.type, row.schedule.type))).orderBy(sql`${categories.parentId} is not null`, categories.createdAt, categories.id).limit(1);
      const [item] = await tx.insert(transactions).values({ userId: user.id, type: row.schedule.type, description: row.schedule.description, categoryId: category?.id ?? null, category: row.schedule.category, amount: row.schedule.amount, transactionDate: row.occurrence.dueDate, paymentMethod: "bank", accountId: row.schedule.accountId }).returning({ id: transactions.id });
      transactionId = item.id;
    }
    const [updated] = await tx.update(recurringOccurrences).set({ transactionId }).where(eq(recurringOccurrences.id, row.occurrence.id)).returning();
    const nextDate = nextDueDate(row.occurrence.dueDate, row.schedule.cadence as Cadence, row.schedule.anchorDay);
    await tx.update(recurring).set({ nextDate }).where(eq(recurring.id, row.schedule.id));
    return updated;
  });
  if (!result) return NextResponse.json({ error: "already-reviewed" }, { status: 409 });
  if (result.transactionId) {
    await evaluateBudgetAlerts(user.id);
    const [item] = await db.select().from(transactions).where(eq(transactions.id, result.transactionId));
    if (item) await evaluateSmartAlerts(user.id, item);
  }
  return NextResponse.json({ occurrence: result });
}
