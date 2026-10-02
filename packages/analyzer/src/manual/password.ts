import { emitKeypressEvents } from "node:readline";

// Secrets never enter argv, stdout, or visible terminal input.
export async function readManualPassword(): Promise<string> {
  const configured = process.env.MANUAL_USER_PASSWORD;
  if (configured !== undefined) {
    if (!configured) throw new Error("MANUAL_USER_PASSWORD 不能为空");
    return configured;
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error("非交互终端需要设置 MANUAL_USER_PASSWORD");
  }
  process.stderr.write("口令（输入隐藏）: ");
  const input = process.stdin;
  const wasRaw = input.isRaw;
  const wasPaused = input.isPaused();
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  try {
    return await new Promise<string>((resolve, reject) => {
      let password = "";
      const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
        if (key.ctrl && key.name === "c") {
          input.removeListener("keypress", onKey);
          reject(new Error("已取消输入口令"));
        } else if (key.name === "return" || key.name === "enter") {
          input.removeListener("keypress", onKey);
          if (password) resolve(password);
          else reject(new Error("口令不能为空"));
        } else if (key.name === "backspace") {
          password = [...password].slice(0, -1).join("");
        } else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
          password += text;
        }
      };
      input.on("keypress", onKey);
    });
  } finally {
    input.setRawMode(wasRaw);
    if (wasPaused) input.pause();
    process.stderr.write("\n");
  }
}
