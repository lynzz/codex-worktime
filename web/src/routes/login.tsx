import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Input, Spinner } from "~/components/ui";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function login() {
    if (!password.trim()) return setError("请输入口令");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "登录失败");
      }
      void navigate({ to: "/home", search: { variant: "timeline" } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-11 w-11 rounded-[10px] shadow-sm" />
          <h1 className="text-lg font-semibold">工时速记</h1>
          <p className="text-xs text-zinc-400">请输入访问口令</p>
        </div>
        <Input
          type="password"
          aria-label="访问口令"
          placeholder="访问口令"
          className="h-9 w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void login();
            }
          }}
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <Button
          className="mt-4 h-9 w-full"
          variant="primary"
          isDisabled={busy}
          onPress={() => void login()}
        >
          {busy ? <Spinner size="sm" /> : "进入"}
        </Button>
      </div>
    </div>
  );
}
