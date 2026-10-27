import { NextRequest } from "next/server";

export function isSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin) {
    try {
      if (new URL(origin).origin !== request.nextUrl.origin) return false;
    } catch {
      return false;
    }
  }
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

// Drizzle wraps driver errors in DrizzleQueryError, so the Postgres code may sit on `cause`.
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
