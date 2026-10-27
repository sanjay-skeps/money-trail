import "server-only";
import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createSession, destroySession } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts, categories, users } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/server/http";

export const signupInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(72),
});

export const loginInput = z.object({
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72),
});

export async function createAccount(input: z.infer<typeof signupInput>) {
  const passwordHash = await hash(input.password, 12);
  try {
    const user = await db.transaction(async (tx) => {
      const [created] = await tx.insert(users).values({ name: input.name, email: input.email, passwordHash }).returning({ id: users.id, name: users.name, email: users.email, currency: users.currency });
      if (!created) return null;
      await tx.insert(accounts).values({ userId: created.id, name: "Cash", type: "cash", kind: "asset" });
      await tx.insert(categories).values(["Food", "Transport", "Shopping", "Bills", "Health", "Entertainment", "Other"].map((name) => ({ userId: created.id, name, type: "expense", isDefault: true })).concat([{ userId: created.id, name: "Salary", type: "income", isDefault: true }, { userId: created.id, name: "Other income", type: "income", isDefault: true }]));
      return created;
    });
    if (!user) return { ok: false as const, reason: "unknown" as const };
    await createSession(user.id);
    return { ok: true as const, user };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false as const, reason: "exists" as const };
    }
    throw error;
  }
}

export async function authenticate(input: z.infer<typeof loginInput>) {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user || !(await compare(input.password, user.passwordHash))) return null;
  await destroySession();
  await createSession(user.id);
  return { id: user.id, name: user.name, email: user.email, currency: user.currency };
}

export async function logout() {
  await destroySession();
}
