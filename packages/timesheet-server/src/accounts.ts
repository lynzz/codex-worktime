import { eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { entries, projects, tasks, users } from "./schema.js";

const encoder = new TextEncoder();
const ITERATIONS = 100_000; // Cloudflare Workers' PBKDF2 iteration limit.
const MAX_PASSWORD_BYTES = 1024;

export function isValidUsername(username: unknown): username is string {
  return typeof username === "string" && username.length >= 2 && username.length <= 32 &&
    !/[^a-z0-9_-]/.test(username);
}

export function isValidPassword(password: unknown): password is string {
  return typeof password === "string" && password.length > 0 &&
    password.length <= MAX_PASSWORD_BYTES && encoder.encode(password).byteLength <= MAX_PASSWORD_BYTES;
}

function validateUsername(username: string) {
  if (!isValidUsername(username)) {
    throw new Error("用户名须为 2–32 位小写字母、数字、下划线或连字符");
  }
}

function validatePassword(password: string) {
  if (!isValidPassword(password)) {
    throw new Error("口令不能为空，且不得超过 1024 个 UTF-8 字节");
  }
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decodeBase64(value: string, length: number): Uint8Array | undefined {
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    if (bytes.length !== length || encodeBase64(bytes) !== value) return undefined;
    return bytes;
  } catch {
    return undefined;
  }
}

async function derivePassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations: ITERATIONS },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt);
  return `pbkdf2$${ITERATIONS}$${encodeBase64(salt)}$${encodeBase64(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (!isValidPassword(password) || typeof encoded !== "string") return false;
  const match = /^pbkdf2\$100000\$([A-Za-z0-9+/]{22}==)\$([A-Za-z0-9+/]{43}=)$/.exec(encoded);
  if (!match || match[0] !== encoded) return false;
  const salt = decodeBase64(match[1]!, 16);
  const expected = decodeBase64(match[2]!, 32);
  if (!salt || !expected) return false;
  const actual = await derivePassword(password, salt);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i]! ^ expected[i]!;
  return difference === 0;
}

export async function findUserByUsername(username: string): Promise<typeof users.$inferSelect | undefined> {
  if (!isValidUsername(username)) return undefined;
  const [user] = await getDb().select().from(users).where(eq(users.username, username)).limit(1);
  return user;
}

export async function addUser(username: string, password: string) {
  validateUsername(username);
  validatePassword(password);
  if (await findUserByUsername(username)) throw new Error("用户名已存在");
  const passwordHash = await hashPassword(password);
  try {
    const [user] = await getDb().insert(users).values({
      id: crypto.randomUUID(), username, passwordHash,
    }).returning({ id: users.id, username: users.username, createdAt: users.createdAt });
    return user!;
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    // Drizzle errors include query parameters; never expose password hashes.
    if (failure.code === "23505" || failure.cause?.code === "23505") throw new Error("用户名已存在");
    throw new Error("无法创建用户");
  }
}

export async function resetUserPassword(username: string, password: string): Promise<void> {
  validateUsername(username);
  validatePassword(password);
  const user = await findUserByUsername(username);
  if (!user) throw new Error("用户不存在");
  const passwordHash = await hashPassword(password);
  try {
    await getDb().update(users).set({ passwordHash }).where(eq(users.id, user.id));
  } catch {
    throw new Error("无法重置口令");
  }
}

export async function listUsers() {
  return getDb().select({ username: users.username, createdAt: users.createdAt }).from(users).orderBy(users.username);
}

export async function claimOrphans(username: string): Promise<{ projects: number; tasks: number; entries: number }> {
  validateUsername(username);
  const user = await findUserByUsername(username);
  if (!user) throw new Error("用户不存在");
  const db = getDb();
  try {
    // neon-http batches execute in one transaction. Lock before validating so a
    // concurrent claim/write cannot change the graph between validation and updates.
    const [, , claimedProjects, claimedTasks, claimedEntries] = await db.batch([
      db.execute(sql`lock table projects, tasks, entries in share row exclusive mode`),
      // Abort the transaction on inconsistent post-claim links, before any mutation.
      // NULL owners are interpreted as the requested owner only for this validation.
      db.execute(sql`select 1 / case when exists (
        select 1 from tasks t join projects p on p.id = t.project_id
        where coalesce(t.user_id, ${user.id}) <> coalesce(p.user_id, ${user.id})
        union all
        select 1 from entries e join projects p on p.id = e.project_id
        left join tasks t on t.id = e.task_id
        where coalesce(e.user_id, ${user.id}) <> coalesce(p.user_id, ${user.id})
          or (e.task_id is not null and (
            coalesce(e.user_id, ${user.id}) <> coalesce(t.user_id, ${user.id})
            or e.project_id <> t.project_id
          ))
      ) then 0 else 1 end as ownership_consistent`),
      db.update(projects).set({ userId: user.id }).where(isNull(projects.userId)).returning({ id: projects.id }),
      db.update(tasks).set({ userId: user.id }).where(isNull(tasks.userId)).returning({ id: tasks.id }),
      db.update(entries).set({ userId: user.id }).where(isNull(entries.userId)).returning({ id: entries.id }),
    ]);
    return { projects: claimedProjects.length, tasks: claimedTasks.length, entries: claimedEntries.length };
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    if (failure.code === "22012" || failure.cause?.code === "22012") {
      throw new Error("无法认领：项目、任务行和工时的关联必须属于同一用户", { cause: error });
    }
    throw error;
  }
}
