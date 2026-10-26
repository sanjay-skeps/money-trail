import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts, recurring, recurringOccurrences } from "@/lib/db/schema";
import { isSameOriginRequest, readJson } from "@/lib/server/http";
export const runtime = "nodejs";
const schema = z.object({ type: z.enum(["income", "expense"]), description: z.string().trim().min(1).max(160), category: z.string().trim().min(1).max(60).default("Other"), amount: z.coerce.number().positive(), cadence: z.enum(["weekly", "monthly", "yearly"]), nextDate: z.iso.date(), accountId: z.uuid().nullable().optional() });
export async function GET() {
  const user = await getCurrentUserWithRefresh(); if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const schedules = await db.select().from(recurring).where(eq(recurring.userId, user.id));
  const today = new Date().toISOString().slice(0, 10);
  for (const schedule of schedules) if (schedule.active && schedule.nextDate <= today) await db.insert(recurringOccurrences).values({ recurringId: schedule.id, dueDate: schedule.nextDate }).onConflictDoNothing();
  const due = await db.select({ occurrence: recurringOccurrences, schedule: recurring }).from(recurringOccurrences).innerJoin(recurring, eq(recurring.id, recurringOccurrences.recurringId)).where(and(eq(recurring.userId, user.id), eq(recurring.active, true), eq(recurringOccurrences.status, "pending")));
  return NextResponse.json({ recurring: schedules, due });
}
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh(); if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const input = schema.safeParse(await readJson(request)); if (!input.success) return NextResponse.json({ error: "recurring" }, { status: 400 });
  if (input.data.accountId) { const [account] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.data.accountId), eq(accounts.userId, user.id))); if (!account) return NextResponse.json({ error: "account" }, { status: 400 }); }
  const [schedule] = await db.insert(recurring).values({ ...input.data, userId: user.id, amount: input.data.amount.toFixed(2), accountId: input.data.accountId ?? null }).returning();
  return NextResponse.json({ recurring: schedule }, { status: 201 });
}
