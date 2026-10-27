import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { db } from "@/lib/db";
import { budgets, categories, recurring, transactions } from "@/lib/db/schema";
import { isSameOriginRequest, isUniqueViolation, readJson } from "@/lib/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, { params }: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh(); if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const id = z.uuid().safeParse((await params).id), input = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await readJson(request));
  if (!id.success || !input.success) return NextResponse.json({ error: "category" }, { status: 400 });
  try {
    const category = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(categories).where(and(eq(categories.id, id.data), eq(categories.userId, user.id), eq(categories.isDefault, false)));
      if (!old) return null;
      const [updated] = await tx.update(categories).set({ name: input.data.name }).where(eq(categories.id, old.id)).returning();
      // Reports group by the denormalized category name, so carry the rename through.
      await tx.update(transactions).set({ category: input.data.name }).where(and(eq(transactions.userId, user.id), eq(transactions.categoryId, old.id)));
      await tx.update(recurring).set({ category: input.data.name }).where(and(eq(recurring.userId, user.id), eq(recurring.type, old.type), eq(recurring.category, old.name)));
      return updated;
    });
    return category ? NextResponse.json({ category }) : NextResponse.json({ error: "not-found" }, { status: 404 });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: "exists" }, { status: 409 });
    throw error;
  }
}
export async function DELETE(request: NextRequest, { params }: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh(); if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const id = z.uuid().safeParse((await params).id); if (!id.success) return NextResponse.json({ error: "not-found" }, { status: 404 });
  try {
    const category = await db.transaction(async (tx) => {
      // Check ownership first so default or foreign categories leave budgets and children untouched.
      const [owned] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.id, id.data), eq(categories.userId, user.id), eq(categories.isDefault, false)));
      if (!owned) return null;
      await tx.update(budgets).set({ active: false }).where(and(eq(budgets.categoryId, owned.id), eq(budgets.userId, user.id)));
      await tx.update(categories).set({ parentId: null }).where(and(eq(categories.parentId, owned.id), eq(categories.userId, user.id)));
      const [deleted] = await tx.delete(categories).where(eq(categories.id, owned.id)).returning({ id: categories.id });
      return deleted;
    });
    return category ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "not-found" }, { status: 404 });
  } catch (error) {
    // A subcategory moved to the top level clashes with an existing top-level category of the same name.
    if (isUniqueViolation(error)) return NextResponse.json({ error: "exists" }, { status: 409 });
    throw error;
  }
}
