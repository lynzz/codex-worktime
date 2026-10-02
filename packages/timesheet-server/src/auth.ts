import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { findUserByUsername, isValidPassword, isValidUsername, verifyPassword } from "./accounts.js";
import { getDb } from "./db.js";
import { users } from "./schema.js";

export type AppEnv = { Variables: { userId: string } };

const COOKIE = "gongshi_auth";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const encoder = new TextEncoder();
// A valid encoding ensures nonexistent users incur the same PBKDF2 work as a bad password.
const FAKE_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function isValidUserId(userId: string): boolean {
  return userId.length > 0 && userId.length <= 128 && !/[^A-Za-z0-9_-]/.test(userId);
}


async function signSession(userId: string, expiresAt: number, secret: string): Promise<string> {
  if (!isValidUserId(userId)) throw new Error("用户 ID 格式无效");
  const payload = `${userId}.${expiresAt}`;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${payload}.${hex}`;
}

async function verifySession(cookie: string | undefined, secret: string): Promise<string | undefined> {
  if (!cookie) return undefined;
  const parts = cookie.split(".");
  if (parts.length !== 3) return undefined;
  const [userId, expiry, signature] = parts as [string, string, string];
  if (!isValidUserId(userId) || !/^[1-9][0-9]{0,15}$/.test(expiry) ||
    signature.length !== 64 || !/^[a-f0-9]{64}$/.test(signature)) return undefined;
  const expiresAt = Number(expiry);
  const now = Date.now();
  if (!Number.isSafeInteger(expiresAt) || String(expiresAt) !== expiry ||
    expiresAt <= now || expiresAt > now + SESSION_TTL_MS) return undefined;
  const bytes = Uint8Array.from(signature.match(/../g)!, (hex) => Number.parseInt(hex, 16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, bytes, encoder.encode(`${userId}.${expiry}`));
  return valid ? userId : undefined;
}

function unavailable(c: Context<AppEnv>) {
  return c.json({ error: "SESSION_SECRET 未配置" }, 503);
}

export async function checkAuth(c: Context<AppEnv>): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const userId = await verifySession(getCookie(c, COOKIE), secret);
  if (!userId) return false;
  const [user] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return false;
  c.set("userId", user.id);
  return true;
}

export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!process.env.SESSION_SECRET) return unavailable(c);
    if (!(await checkAuth(c))) return c.body("Unauthorized", 401);
    await next();
  };
}

export async function loginHandler(c: Context<AppEnv>) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return unavailable(c);
  const body: unknown = await c.req.json().catch(() => null);
  const credentials = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
  const username = credentials.username;
  const password = credentials.password;
  const user = isValidUsername(username) ? await findUserByUsername(username) : undefined;
  const validPassword = isValidPassword(password);
  const verified = await verifyPassword(validPassword ? password : "invalid-credentials", user?.passwordHash ?? FAKE_HASH);
  if (!user || !validPassword || !verified || !isValidUserId(user.id)) {
    return c.json({ error: "用户名或口令不正确" }, 401);
  }
  const expiresAt = Date.now() + SESSION_TTL_MS;
  setCookie(c, COOKIE, await signSession(user.id, expiresAt, secret), {
    path: "/", httpOnly: true, sameSite: "Lax", maxAge: SESSION_TTL_MS / 1000,
    secure: process.env.NODE_ENV === "production",
  });
  return c.json({ ok: true, expiresAt });
}

export async function meHandler(c: Context<AppEnv>) {
  const [user] = await getDb().select({ username: users.username }).from(users).where(eq(users.id, c.get("userId"))).limit(1);
  if (!user) return c.body("Unauthorized", 401);
  return c.json(user);
}

export function logoutHandler(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, {
    path: "/", httpOnly: true, sameSite: "Lax", secure: process.env.NODE_ENV === "production",
  });
  return c.json({ ok: true });
}
