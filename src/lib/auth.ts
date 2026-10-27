import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { refreshSessions, users } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/types";

const accessCookieName = "money-trail-access";
const refreshCookieName = "money-trail-refresh";
const accessLifetimeSeconds = 15 * 60;
const refreshLifetimeSeconds = 30 * 24 * 60 * 60;
const refreshReuseGraceMs = 30 * 1000;
const issuer = "money-trail";
const audience = "money-trail-web";
const masterSecret = process.env.SESSION_SECRET ?? "";
const keyFromLabel = (label: string) =>
  masterSecret.length >= 32
    ? createHmac("sha256", masterSecret).update(`money-trail:${label}`).digest()
    : Buffer.alloc(32);
const accessSecret = keyFromLabel("access-token");
const refreshSecret = keyFromLabel("refresh-token");

export type TokenPair = { accessToken: string; refreshToken: string; refreshId: string; familyId: string; userId: string; expiresAt: Date };

function assertConfigured() {
  if (masterSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
}

async function signAccessToken(userId: string, familyId: string) {
  return new SignJWT({ token_use: "access", family_id: familyId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${accessLifetimeSeconds}s`)
    .sign(accessSecret);
}

async function signRefreshToken(userId: string, refreshId: string, familyId: string) {
  return new SignJWT({ token_use: "refresh", family_id: familyId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setJti(refreshId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${refreshLifetimeSeconds}s`)
    .sign(refreshSecret);
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function writeTokenCookies(pair: Pick<TokenPair, "accessToken" | "refreshToken">) {
  const jar = await cookies();
  jar.set(accessCookieName, pair.accessToken, cookieOptions(accessLifetimeSeconds));
  jar.set(refreshCookieName, pair.refreshToken, cookieOptions(refreshLifetimeSeconds));
}

export async function clearTokenCookies() {
  const jar = await cookies();
  jar.delete(accessCookieName);
  jar.delete(refreshCookieName);
  jar.delete("money-trail-session");
}

export async function createSession(userId: string) {
  assertConfigured();
  const refreshId = randomUUID();
  const familyId = randomUUID();
  const expiresAt = new Date(Date.now() + refreshLifetimeSeconds * 1000);
  const pair: TokenPair = {
    accessToken: await signAccessToken(userId, familyId),
    refreshToken: await signRefreshToken(userId, refreshId, familyId),
    refreshId,
    familyId,
    userId,
    expiresAt,
  };

  await db.insert(refreshSessions).values({
    id: pair.refreshId,
    familyId: pair.familyId,
    userId: pair.userId,
    expiresAt: pair.expiresAt,
  });
  await writeTokenCookies(pair);
}

type RefreshPayload = JWTPayload & { token_use?: string; family_id?: string };

async function verifyRefreshToken(token: string): Promise<RefreshPayload | null> {
  assertConfigured();
  try {
    const { payload } = await jwtVerify(token, refreshSecret, { issuer, audience, algorithms: ["HS256"] });
    if (payload.token_use !== "refresh" || typeof payload.sub !== "string" || typeof payload.jti !== "string" || typeof payload.family_id !== "string") return null;
    return payload as RefreshPayload;
  } catch {
    return null;
  }
}

export async function rotateRefreshToken(token: string): Promise<TokenPair | null> {
  const payload = await verifyRefreshToken(token);
  if (!payload?.sub || !payload.jti || !payload.family_id || !payload.exp) return null;

  const [session] = await db.select().from(refreshSessions).where(and(
    eq(refreshSessions.id, payload.jti),
    eq(refreshSessions.userId, payload.sub),
    eq(refreshSessions.familyId, payload.family_id),
  )).limit(1);

  if (!session) return null;
  const now = new Date();
  if (session.expiresAt <= now) {
    await db.update(refreshSessions).set({ revokedAt: now }).where(and(eq(refreshSessions.id, session.id), isNull(refreshSessions.revokedAt)));
    return null;
  }
  if (session.revokedAt) return reuseOrRevoke(session, now);

  const pair = await newTokenPair(session.userId, session.familyId);
  const rotated = await db.transaction(async (tx) => {
    const [revoked] = await tx.update(refreshSessions)
      .set({ revokedAt: now })
      .where(and(
        eq(refreshSessions.id, session.id),
        eq(refreshSessions.userId, session.userId),
        isNull(refreshSessions.revokedAt),
        gt(refreshSessions.expiresAt, now),
      ))
      .returning({ id: refreshSessions.id });
    if (!revoked) return false;
    await tx.insert(refreshSessions).values({
      id: pair.refreshId,
      familyId: pair.familyId,
      userId: pair.userId,
      expiresAt: pair.expiresAt,
    });
    return true;
  });

  if (!rotated) {
    // A concurrent request rotated this token first; treat it like any other reuse.
    const [current] = await db.select().from(refreshSessions).where(eq(refreshSessions.id, session.id)).limit(1);
    return current?.revokedAt ? reuseOrRevoke(current, new Date()) : null;
  }
  return pair;
}

async function newTokenPair(userId: string, familyId: string): Promise<TokenPair> {
  const refreshId = randomUUID();
  return {
    accessToken: await signAccessToken(userId, familyId),
    refreshToken: await signRefreshToken(userId, refreshId, familyId),
    refreshId,
    familyId,
    userId,
    expiresAt: new Date(Date.now() + refreshLifetimeSeconds * 1000),
  };
}

/**
 * A refresh token presented again shortly after it was rotated is usually a benign race
 * (parallel requests or tabs sending the old cookie), so it gets a sibling session in the
 * same family. Later reuse, or reuse after the family was revoked (logout, password change),
 * is treated as theft and revokes the whole family.
 */
async function reuseOrRevoke(session: typeof refreshSessions.$inferSelect, now: Date): Promise<TokenPair | null> {
  const recentlyRotated = !!session.revokedAt && now.getTime() - session.revokedAt.getTime() < refreshReuseGraceMs;
  if (recentlyRotated) {
    const [active] = await db.select({ id: refreshSessions.id }).from(refreshSessions).where(and(
      eq(refreshSessions.familyId, session.familyId),
      isNull(refreshSessions.revokedAt),
      gt(refreshSessions.expiresAt, now),
    )).limit(1);
    if (active) {
      const pair = await newTokenPair(session.userId, session.familyId);
      await db.insert(refreshSessions).values({ id: pair.refreshId, familyId: pair.familyId, userId: pair.userId, expiresAt: pair.expiresAt });
      return pair;
    }
  }
  await db.update(refreshSessions).set({ revokedAt: now }).where(and(
    eq(refreshSessions.familyId, session.familyId),
    isNull(refreshSessions.revokedAt),
  ));
  return null;
}

export async function destroySession() {
  const jar = await cookies();
  const refreshToken = jar.get(refreshCookieName)?.value;
  const accessToken = jar.get(accessCookieName)?.value;
  let familyId: string | undefined;
  if (refreshToken) {
    const payload = await verifyRefreshToken(refreshToken);
    familyId = payload?.family_id;
  }
  if (!familyId && accessToken && masterSecret.length >= 32) {
    try {
      const { payload } = await jwtVerify(accessToken, accessSecret, { issuer, audience, algorithms: ["HS256"] });
      if (payload.token_use === "access" && typeof payload.family_id === "string") familyId = payload.family_id;
    } catch {
      // The browser may hold expired or invalid cookies; clear them below regardless.
    }
  }
  if (familyId) {
    await db.update(refreshSessions).set({ revokedAt: new Date() }).where(and(
      eq(refreshSessions.familyId, familyId),
      isNull(refreshSessions.revokedAt),
    ));
  }
  await clearTokenCookies();
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  assertConfigured();
  const token = (await cookies()).get(accessCookieName)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, accessSecret, { issuer, audience, algorithms: ["HS256"] });
    if (payload.token_use !== "access" || typeof payload.sub !== "string" || typeof payload.family_id !== "string") return null;
    const [result] = await db
      .select({ id: users.id, name: users.name, email: users.email, currency: users.currency })
      .from(users)
      .innerJoin(refreshSessions, and(
        eq(refreshSessions.userId, users.id),
        eq(refreshSessions.familyId, payload.family_id),
        isNull(refreshSessions.revokedAt),
        gt(refreshSessions.expiresAt, new Date()),
      ))
      .where(eq(users.id, payload.sub))
      .limit(1);
    return result ?? null;
  } catch {
    return null;
  }
}

export async function getCurrentUserWithRefresh(): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  if (user) return user;
  const jar = await cookies();
  const token = jar.get(refreshCookieName)?.value;
  if (!token) return null;
  const pair = await rotateRefreshToken(token);
  if (!pair) {
    await clearTokenCookies();
    return null;
  }
  await writeTokenCookies(pair);
  return getCurrentUser();
}

export function isSafeReturnTo(value: string | null) {
  return !!value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/api/") && !value.includes("\\");
}
