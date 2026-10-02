import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../src/api";
import { getDb } from "../src/db";
import { entries, projects, tasks, users } from "../src/schema";
import { hashPassword } from "../src/accounts";

// 从仓库根 .env.local 加载测试连接串等环境变量
const rootEnv = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.env.local",
);
try {
  process.loadEnvFile(rootEnv);
} catch {
  // 无 .env.local 时按未配置处理(集成测试跳过)
}

export const TEST_USER_ID = "integration-user";
const TEST_USERNAME = "integration";
const TEST_PASSWORD = "integration-password";
let cookie: string | undefined;
let passwordHash: Promise<string> | undefined;

/** Clears only the explicitly configured test database, then logs in publicly. */
export async function resetTestData() {
  const testUrl = process.env.NEON_TEST_DATABASE_URL;
  if (!testUrl) throw new Error("NEON_TEST_DATABASE_URL is required to reset test data");
  process.env.DATABASE_URL = testUrl;
  process.env.SESSION_SECRET ??= "integration-test-session-secret";
  const db = getDb();
  await db.batch([
    db.delete(entries),
    db.delete(tasks),
    db.delete(projects),
    db.delete(users),
  ]);
  passwordHash ??= hashPassword(TEST_PASSWORD);
  await db.insert(users).values({
    id: TEST_USER_ID,
    username: TEST_USERNAME,
    passwordHash: await passwordHash,
  });
  const response = await api.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  const session = response.headers.get("set-cookie")?.split(";")[0];
  if (response.status !== 200 || !session) throw new Error("Test account login failed");
  cookie = session;
}

/** Uses a real login cookie; no middleware bypass or internal headers. */
export const testApi = {
  request(input: string | Request | URL, init?: RequestInit) {
    if (!cookie) throw new Error("resetTestData must log in before authenticated requests");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("cookie", cookie);
    return api.request(input, { ...init, headers });
  },
};
