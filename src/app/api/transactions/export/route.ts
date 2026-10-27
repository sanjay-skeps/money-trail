import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { getFilteredCsvExport } from "@/lib/server/profile-service";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const user = await getCurrentUserWithRefresh();
  if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const query = request.nextUrl.searchParams;
  const csv = await getFilteredCsvExport(user.id, { q: query.get("q") ?? "", type: query.get("type") ?? "", category: query.get("category") ?? "", from: query.get("from") ?? "", to: query.get("to") ?? "" });
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="money-trail-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
