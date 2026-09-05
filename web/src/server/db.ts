import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

// Neon CLI 把连接串写在仓库根 .env.local;生产形态由 manual serve 注入环境变量(T8)。
function loadEnvOnce() {
  if (process.env.DATABASE_URL) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../.env.local"), // 仓库根
    path.resolve(here, "../../.env.local"), // web/
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

export function getDb() {
  // 本机到 Neon 的 HTTPS 偶发抖动,两条端点互为回退
  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error("DATABASE_URL 未配置:Neon 连接串应位于仓库根 .env.local");
  }
  return drizzle(neon(connectionString));
}
