import { getCookie } from "hono/cookie";

// 单用户登录:ACCESS_PASSWORD(secret)→ HMAC 签名 cookie(Web Crypto,Workers 兼容)
const COOKIE = "gongshi_auth";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天

const encoder = new TextEncoder();

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signSession(expiresAt: number, secret: string): Promise<string> {
  return `${expiresAt}.${await hmac(String(expiresAt), secret)}`;
}

async function verifySession(cookie: string | undefined, secret: string): Promise<boolean> {
  if (!cookie) return false;
  const [expRaw, sig] = cookie.split(".");
  if (!expRaw || !sig) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmac(expRaw, secret);
  if (expected.length !== sig.length) return false;
  // 常数时间比较
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized(c: { header: (k: string, v: string) => void; body: (b: string, s: 401) => Response }) {
  c.header("WWW-Authenticate", 'Basic realm="gongshi"');
  return c.body("Unauthorized", 401);
}

// 挂在 Hono 应用最外层:未登录的 API 请求一律 401
export function authMiddleware() {
  const secret = process.env.ACCESS_PASSWORD ?? "";
  return async (c: any, next: () => Promise<void>) => {
    // 未配置口令 = 不启用登录(本地开发)
    if (!secret) return next();
    // 服务端内部调用(loader 的 server fn 直连 Hono):内部头携带口令即可
    if (c.req.header("x-internal-key") === secret) return next();
    const cookie = getCookie(c as never, COOKIE);
    if (await verifySession(cookie, secret)) return next();
    return unauthorized(c);
  };
}

// 登录:校验口令,签发 30 天 cookie
export async function loginHandler(c: any) {
  const secret = process.env.ACCESS_PASSWORD ?? "";
  if (!secret) return c.json({ ok: true, enabled: false }, 200);
  const { password } = (await c.req.json().catch(() => ({}))) as { password?: string };
  if (!password || password !== secret) {
    return c.json({ error: "口令不正确" }, 401);
  }
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = await signSession(expiresAt, secret);
  setAuthCookie(c, token);
  return c.json({ ok: true, expiresAt });
}

export function setAuthCookie(c: any, token: string) {
  c.header(
    "set-cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
}

export function logoutHandler(c: any) {
  c.header("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return c.json({ ok: true });
}

export async function checkAuth(c: any): Promise<boolean> {
  const secret = process.env.ACCESS_PASSWORD ?? "";
  if (!secret) return true;
  return verifySession(getCookie(c as never, COOKIE), secret);
}
