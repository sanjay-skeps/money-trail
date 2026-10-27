import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { createRule, listRules, ruleInput } from "@/lib/server/import-service";
import { isSameOriginRequest, isUniqueViolation, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export async function GET() {
  const user = await getCurrentUserWithRefresh();
  if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  return NextResponse.json({ rules: await listRules(user.id) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh();
  if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const parsed = ruleInput.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "rule" }, { status: 400 });
  try {
    const rule = await createRule(user.id, parsed.data);
    return rule ? NextResponse.json({ rule }, { status: 201 }) : NextResponse.json({ error: "category" }, { status: 400 });
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: "rule-exists" }, { status: 409 });
    throw error;
  }
}
