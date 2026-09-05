import { defineConfig } from "drizzle-kit";

// 连接串来自环境变量:开发用仓库根 .env.local 的 DATABASE_URL,
// 集成测试用 NEON_TEST_DATABASE_URL,由调用方注入。
const url = process.env.DATABASE_URL ?? process.env.NEON_TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "drizzle-kit 需要 DATABASE_URL 或 NEON_TEST_DATABASE_URL(见仓库根 .env.local)",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  url,
  strict: true,
});
