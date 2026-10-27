import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { commitImport, importInput, previewImport } from "@/lib/server/import-service";
import { isSameOriginRequest, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh();
  if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const parsed = importInput.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "import" }, { status: 400 });
  if (parsed.data.mode === "preview") return NextResponse.json({ rows: await previewImport(user.id, parsed.data.rows) });
  const result = await commitImport(user.id, parsed.data);
  return "error" in result ? NextResponse.json({ error: result.error }, { status: 400 }) : NextResponse.json(result, { status: 201 });
}
