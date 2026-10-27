import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts, alerts, recurring } from "@/lib/db/schema";
import { isSameOriginRequest, readJson } from "@/lib/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const patchSchema = z.object({ description: z.string().trim().min(1).max(160).optional(), amount: z.coerce.number().positive().optional(), category: z.string().trim().min(1).max(60).optional(), cadence: z.enum(["weekly", "monthly", "yearly"]).optional(), nextDate: z.iso.date().optional(), accountId: z.uuid().nullable().optional(), active: z.boolean().optional() }).refine((item) => Object.keys(item).length > 0);
export async function PATCH(request: NextRequest, { params }: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh(); if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const id = z.uuid().safeParse((await params).id), input = patchSchema.safeParse(await readJson(request));
  if (!id.success || !input.success) return NextResponse.json({ error: "recurring" }, { status: 400 });
  const [old] = await db.select().from(recurring).where(and(eq(recurring.id, id.data), eq(recurring.userId, user.id)));
  if (!old) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (input.data.accountId) { const [account] = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, input.data.accountId), eq(accounts.userId, user.id))); if (!account) return NextResponse.json({ error: "account" }, { status: 400 }); }
  const { amount, ...rest } = input.data;
  const [schedule] = await db.update(recurring).set({ ...rest, amount: amount?.toFixed(2), ...(rest.nextDate ? { anchorDay: Number(rest.nextDate.slice(8, 10)) } : {}) }).where(and(eq(recurring.id, id.data), eq(recurring.userId, user.id))).returning();
  if (input.data.amount && input.data.amount > Number(old.amount)) await db.insert(alerts).values({ userId: user.id, key: `subscription-increase:${old.id}:${new Date().toISOString().slice(0, 10)}`, kind: "subscription-change", message: `${old.description} increased by ${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(input.data.amount - Number(old.amount))}.` }).onConflictDoNothing();
  return NextResponse.json({ recurring: schedule });
}
export async function DELETE(request: NextRequest, { params }: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh(); if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const id = z.uuid().safeParse((await params).id); if (!id.success) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const [item] = await db.update(recurring).set({ active: false }).where(and(eq(recurring.id, id.data), eq(recurring.userId, user.id))).returning({ id: recurring.id });
  return item ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "not-found" }, { status: 404 });
}
