import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Input, Spinner } from "~/components/ui";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "登录失败");
      }
      // 新会话用整页导航,不复用上一账号的路由缓存。
      location.replace("/home?variant=timeline");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <form
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void login();
        }}
      >
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-11 w-11 rounded-[10px] shadow-sm" />
          <h1 className="text-lg font-semibold">工时速记</h1>
          <p className="text-xs text-zinc-400">使用用户名和密码登录</p>
        </div>
        <Input
          name="username"
          autoComplete="username"
          aria-label="用户名"
          placeholder="用户名"
          pattern="[a-z0-9_-]{2,32}"
          title="2–32 位小写字母、数字、下划线或连字符"
          required
          autoCapitalize="none"
          spellCheck={false}
          className="mb-3 h-9 w-full"
          value={username}
          disabled={busy}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          aria-label="密码"
          placeholder="密码"
          required
          disabled={busy}
          className="h-9 w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={error ? "login-error" : undefined}
        />
        {error && <p id="login-error" role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        <Button
          className="mt-4 h-9 w-full"
          variant="primary"
          isDisabled={busy}
          type="submit"
        >
          {busy ? <Spinner size="sm" /> : "进入"}
        </Button>
      </form>
    </div>
  );
}
