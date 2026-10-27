import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { listTransactions, saveTransaction, transactionInput } from "@/lib/server/ledger-service";
import { isSameOriginRequest, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
const pageInput = z.object({ limit: z.coerce.number().int().min(1).max(100), offset: z.coerce.number().int().min(0).default(0) });
export async function GET(request: NextRequest) {
  const user = await getCurrentUserWithRefresh();
  if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const query = request.nextUrl.searchParams;
  const filters = { q: query.get("q") ?? "", type: query.get("type") ?? "", category: query.get("category") ?? "", from: query.get("from") ?? "", to: query.get("to") ?? "" };
  if (!query.has("limit")) return NextResponse.json({ transactions: await listTransactions(user.id, filters) }, { headers: { "Cache-Control": "no-store" } });
  const page = pageInput.safeParse({ limit: query.get("limit"), offset: query.get("offset") ?? undefined });
  if (!page.success) return NextResponse.json({ error: "page" }, { status: 400 });
  // Fetch one extra row to learn whether another page exists.
  const rows = await listTransactions(user.id, { ...filters, limit: page.data.limit + 1, offset: page.data.offset });
  return NextResponse.json({ transactions: rows.slice(0, page.data.limit), hasMore: rows.length > page.data.limit }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh();
  if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const parsed = transactionInput.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "transaction" }, { status: 400 });
  const result = await saveTransaction(user.id, parsed.data);
  return "error" in result ? NextResponse.json({ error: result.error }, { status: 400 }) : NextResponse.json(result, { status: 201 });
}
