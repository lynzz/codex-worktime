import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// neon-http(fetch 驱动):Node 与 Cloudflare Workers 通用;
// 自定义 fetch 带瞬时错误重试,对冲跨境链路抖动。
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      const err = error as Error & { cause?: { code?: string } };
      const transient =
        TRANSIENT_CODES.has(err.cause?.code ?? "") || err.name === "TypeError";
      if (!transient || attempt === 5) throw error;
      lastError = error;
      await sleep(400 * attempt);
    }
  }
  throw lastError;
}

// Neon CLI 把连接串写在仓库根 .env.local;生产形态由部署环境注入(Cloudflare secret / manual serve)。
function loadEnvOnce() {
  if (process.env.DATABASE_URL) return;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const file of [
      path.resolve(here, "../../../.env.local"), // 仓库根
      path.resolve(here, "../../.env.local"), // 本包目录
    ]) {
      try {
        process.loadEnvFile(file);
        if (process.env.DATABASE_URL) return;
      } catch {
        // 文件不存在则尝试下一个
      }
    }
  } catch {
    // Workers 等环境无 node:path/url,由部署环境注入 env
  }
}
loadEnvOnce();

export const dbConfigured = () =>
  Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED);

// 全局替换 neon-http 的 fetch 为重试版(v1.x 通过 neonConfig 注入)
(neonConfig as { fetch?: typeof fetch }).fetch = fetchWithRetry as typeof fetch;

let cachedUrl: string | undefined;
let cachedFn: ReturnType<typeof neon> | undefined;

export function getDb() {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error("DATABASE_URL 未配置:Neon 连接串应位于仓库根 .env.local");
  }
  if (url !== cachedUrl) {
    cachedUrl = url;
    cachedFn = neon(url);
  }
  return drizzle(cachedFn!);
}
