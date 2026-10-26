import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearTokenCookies, isSafeReturnTo, rotateRefreshToken, writeTokenCookies } from "@/lib/auth";
import { isSameOriginRequest } from "@/lib/server/http";

const refreshCookieName = "money-trail-refresh";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Refresh request rejected." }, { status: 403 });
  }

  const returnToValue = request.nextUrl.searchParams.get("returnTo");
  const requestedPath = returnToValue && isSafeReturnTo(returnToValue) ? returnToValue : "/dashboard";
  const target = new URL(requestedPath, request.url);
  const returnTo = target.origin === request.nextUrl.origin ? target : new URL("/dashboard", request.url);
  const jar = await cookies();
  const token = jar.get(refreshCookieName)?.value;
  if (!token) {
    await clearTokenCookies();
    return NextResponse.redirect(new URL("/login?error=session", request.url));
  }

  const pair = await rotateRefreshToken(token);
  if (!pair) {
    await clearTokenCookies();
    return NextResponse.redirect(new URL("/login?error=session", request.url));
  }

  await writeTokenCookies(pair);
  return NextResponse.redirect(returnTo);
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  try {
    const token = (await cookies()).get(refreshCookieName)?.value;
    const pair = token ? await rotateRefreshToken(token) : null;
    if (!pair) {
      await clearTokenCookies();
      return NextResponse.json({ error: "session" }, { status: 401 });
    }
    await writeTokenCookies(pair);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  }
}
