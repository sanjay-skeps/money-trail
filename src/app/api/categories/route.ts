import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { createCategory, listCategories } from "@/lib/server/ledger-service";
import { isSameOriginRequest, isUniqueViolation, readJson } from "@/lib/server/http";
export const runtime = "nodejs";
const schema = z.object({ name: z.string().trim().min(1).max(60), type: z.enum(["expense", "income"]), parentId: z.uuid().nullable().optional() });
export async function GET() { const user = await getCurrentUserWithRefresh(); if (!user) return NextResponse.json({ error: "session" }, { status: 401 }); return NextResponse.json({ categories: await listCategories(user.id) }); }
export async function POST(request: NextRequest) { if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 }); const user = await getCurrentUserWithRefresh(); if (!user) return NextResponse.json({ error: "session" }, { status: 401 }); const input = schema.safeParse(await readJson(request)); if (!input.success) return NextResponse.json({ error: "category" }, { status: 400 }); let category; try { category = await createCategory(user.id, input.data); } catch (error) { if (isUniqueViolation(error)) return NextResponse.json({ error: "exists" }, { status: 409 }); throw error; } return category ? NextResponse.json({ category }, { status: 201 }) : NextResponse.json({ error: "parent" }, { status: 400 }); }
