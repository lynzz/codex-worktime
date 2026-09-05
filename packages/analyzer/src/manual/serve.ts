import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

// web 构建产物入口(nitro node 输出);src 与 dist 编译后相对层级一致
// (packages/analyzer/{src,dist}/manual → 上溯四级 = 仓库根)
const serverEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../web/.output/server/index.mjs",
);

export const DEFAULT_MANUAL_SERVE_PORT = 8787;

export function manualServerEntry(): string {
  return serverEntry;
}

export function startManualServer(options: {
  port: number;
  stdout?: Pick<NodeJS.WriteStream, "write">;
}): ChildProcess {
  if (!existsSync(serverEntry)) {
    throw new Error(
      "web 构建产物不存在:先在仓库根执行 npm run build -w @codex-worktime/web",
    );
  }
  const child = spawn(process.execPath, [serverEntry], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(options.port) },
  });
  options.stdout?.write(
    `${JSON.stringify({ url: `http://localhost:${options.port}`, pid: child.pid })}\n`,
  );
  return child;
}
