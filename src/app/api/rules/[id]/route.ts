import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserWithRefresh } from "@/lib/auth";
import { deleteRule } from "@/lib/server/import-service";
import { isSameOriginRequest } from "@/lib/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function DELETE(request: NextRequest, { params }: Context) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  const user = await getCurrentUserWithRefresh();
  if (!user) return NextResponse.json({ error: "session" }, { status: 401 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success || !(await deleteRule(user.id, id.data))) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
