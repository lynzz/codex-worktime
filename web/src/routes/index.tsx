import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Button, Chip, Input } from "@heroui/react";
import type { Project } from "@codex-worktime/timesheet-core";
import { api as honoApi } from "@codex-worktime/timesheet-server";
import { api } from "~/lib/api";
import { projectColor } from "~/lib/colors";
import { ProjectsPanel } from "~/components/ProjectsPanel";

// 服务端函数:SSR 与客户端导航都在服务端执行,直连 Hono 应用
const loadProjects = createServerFn({ method: "GET" }).handler(async () => {
  const res = await honoApi.request("/api/projects");
  return { projects: (await res.json()) as Project[] };
});

export const Route = createFileRoute("/")({
  loader: () => loadProjects(),
  component: AppShell,
});

function AppShell() {
  const { projects } = Route.useLoaderData();
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const active = projects.filter((p) => !p.archived);
  const refresh = () => void router.invalidate();

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold">工时速记</h1>
          <span className="text-sm text-gray-500">手工登记外包项目投入</span>
        </div>
        <div className="flex items-center gap-2">
          <Chip color="accent" variant="soft" size="sm">
            总工时 0h
          </Chip>
          <Button size="sm" variant="ghost" onPress={() => setPanelOpen(true)}>
            项目 ⚙
          </Button>
        </div>
      </header>

      {active.length === 0 ? (
        <Onboarding onChanged={refresh} />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {active.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-0.5 text-sm font-medium"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: projectColor(p.id) }}
                />
                {p.name}
              </span>
            ))}
          </div>
          <nav className="mt-6 flex gap-2">
            <Button variant="ghost" size="sm">周网格</Button>
            <Button variant="ghost" size="sm">日清单</Button>
            <Button variant="ghost" size="sm">月日历</Button>
          </nav>
          <section className="mt-6 rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400">
            三视图建设中 —— T3 起逐票点亮
          </section>
        </>
      )}

      <ProjectsPanel
        projects={projects}
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onChanged={refresh}
      />
    </main>
  );
}

function Onboarding({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.createProject({ name });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-dashed border-gray-300 p-10 text-center">
      <p className="text-base font-semibold">先添加一个外包项目</p>
      <p className="mt-1 text-sm text-gray-400">
        项目只用于分组,不与任何 AI 时长数据关联
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Input
          placeholder="项目名,如 EQA Platform"
          className="w-64"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
        />
        <Button variant="primary" isDisabled={!name.trim() || busy} onPress={create}>
          添加
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
