import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Button, Chip } from "@heroui/react";
import { z } from "zod";
import {
  addDays,
  todayKey,
  type Entry,
  type Project,
  type Task,
} from "@codex-worktime/timesheet-core";
import { api as honoApi } from "@codex-worktime/timesheet-server";
import { projectColor } from "~/lib/colors";
import { ProjectsPanel } from "~/components/ProjectsPanel";
import { DayList } from "~/components/DayList";

const searchSchema = z.object({
  variant: z.enum(["week", "day", "month"]).catch("day"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(todayKey()),
});

// 服务端函数:SSR 与客户端导航都在服务端执行,直连 Hono 应用。
// 载入项目全集 + 所选日期所在月的条目(±7 天冗余覆盖跨月周)。
const loadTimesheet = createServerFn({ method: "GET" })
  .validator((d: { date: string }) => d)
  .handler(async ({ data }) => {
    const month = data.date.slice(0, 7);
    const from = addDays(`${month}-01`, -7);
    const to = addDays(nextMonthFirst(data.date), 7);
    const [projectsRes, entriesRes, tasksRes] = await Promise.all([
      honoApi.request("/api/projects"),
      honoApi.request(`/api/entries?from=${from}&to=${to}`),
      honoApi.request("/api/tasks"),
    ]);
    return {
      projects: (await projectsRes.json()) as Project[],
      entries: (await entriesRes.json()) as Entry[],
      tasks: (await tasksRes.json()) as Task[],
    };
  });

function nextMonthFirst(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  const d = new Date(y!, m!, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export const Route = createFileRoute("/")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search: { date } }) => ({ date }),
  loader: ({ deps: { date } }) => loadTimesheet({ data: { date } }),
  component: AppShell,
});

function AppShell() {
  const { projects, entries, tasks } = Route.useLoaderData();
  const { variant, date } = Route.useSearch();
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const active = projects.filter((p) => !p.archived);
  const refresh = () => void router.invalidate();

  const setSearch = (patch: { variant?: "week" | "day" | "month"; date?: string }) => {
    // 对象始终携带全量搜索参数;路由搜索类型的推导与 zod catch 有出入,单点断言
    void router.navigate({ search: { variant, date, ...patch } as never });
  };

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
        <section className="mt-10 rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <p className="text-base font-semibold">先在「项目 ⚙」里添加一个外包项目</p>
          <p className="mt-1 text-sm text-gray-400">
            项目只用于分组,不与任何 AI 时长数据关联
          </p>
        </section>
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
            {(["week", "day", "month"] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={variant === v ? "primary" : "ghost"}
                onPress={() => setSearch({ variant: v })}
              >
                {v === "week" ? "周网格" : v === "day" ? "日清单" : "月日历"}
              </Button>
            ))}
          </nav>

          {variant === "day" && (
            <DayList
              date={date}
              projects={projects}
              tasks={tasks}
              entries={entries}
              onDateChange={(d) => setSearch({ date: d })}
              onChanged={refresh}
            />
          )}
          {(variant === "week" || variant === "month") && (
            <section className="mt-6 rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400">
              {variant === "week" ? "周网格" : "月日历"}建设中 —— 后续票点亮
            </section>
          )}
        </>
      )}

      <ProjectsPanel
        projects={projects}
        tasks={tasks}
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onChanged={refresh}
      />
    </main>
  );
}
