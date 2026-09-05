import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// 常驻 Node 服务用 pg 连接池(pooled 端点):跨境链路抖动时由连接池自动重连,
// 比逐查询 HTTPS(neon-http)更稳;neon-http 留给未来 serverless 部署形态。
//
// Neon CLI 把连接串写在仓库根 .env.local;生产形态由 manual serve 注入环境变量(T8)。
function loadEnvOnce() {
  if (process.env.DATABASE_URL) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../.env.local"), // 仓库根
    path.resolve(here, "../../.env.local"), // 本包目录
  ];
  for (const file of candidates) {
    try {
      process.loadEnvFile(file);
      if (process.env.DATABASE_URL) return;
    } catch {
      // 文件不存在则尝试下一个
    }
  }
}
loadEnvOnce();

export const dbConfigured = () =>
  Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED);

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "57P01", // admin shutdown
  "57P03", // cannot connect now
]);

function isTransientError(error: unknown): boolean {
  const err = error as Error & { code?: string };
  if (TRANSIENT_CODES.has(err.code ?? "")) return true;
  const msg = err.message ?? "";
  return (
    msg.includes("Connection terminated") ||
    msg.includes("server closed the connection") ||
    msg.includes("socket hang up") ||
    msg.includes("Connection ended unexpectedly")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 跨境链路偶发重置:给连接池的 query/connect 加瞬时错误重试。
// 仅对 Promise 用法重试(回调透传),drizzle 走 Promise 路径。
function patchPoolWithRetry(pool: Pool): Pool {
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  (pool as Pool & { query: typeof pool.query }).query = ((
    ...args: Parameters<typeof originalQuery>
  ) => {
    if (typeof args[args.length - 1] === "function") {
      return originalQuery(...args);
    }
    return (async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          return await originalQuery(
            ...(args as Parameters<typeof originalQuery>),
          );
        } catch (error) {
          if (!isTransientError(error) || attempt === 5) throw error;
          await sleep(400 * attempt);
        }
      }
      throw new Error("unreachable");
    })() as unknown as ReturnType<typeof originalQuery>;
  }) as typeof pool.query;
  (pool as Pool & { connect: typeof pool.connect }).connect = ((
    ...args: Parameters<typeof originalConnect>
  ) => {
    if (typeof args[args.length - 1] === "function") {
      return originalConnect(...args);
    }
    return (async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          return await originalConnect(
            ...(args as Parameters<typeof originalConnect>),
          );
        } catch (error) {
          if (!isTransientError(error) || attempt === 5) throw error;
          await sleep(400 * attempt);
        }
      }
      throw new Error("unreachable");
    })() as unknown as ReturnType<typeof originalConnect>;
  }) as typeof pool.connect;
  return pool;
}

let pool: Pool | undefined;
let poolUrl: string | undefined;

export function getDb() {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error("DATABASE_URL 未配置:Neon 连接串应位于仓库根 .env.local");
  }
  if (!pool || poolUrl !== url) {
    void pool?.end().catch(() => undefined);
    pool = patchPoolWithRetry(
      new Pool({
        connectionString: url,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      }),
    );
    poolUrl = url;
  }
  return drizzle(pool);
}
