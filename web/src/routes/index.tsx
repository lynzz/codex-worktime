import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Button, Card, Chip, Tabs } from "~/components/ui";
import { z } from "zod";
import {
  addDays,
  dayOfWeekCN,
  formatHours,
  monthStart,
  nextMonthFirst,
  startOfWeek,
  todayKey,
  type Entry,
  type Project,
  type Task,
} from "@codex-worktime/timesheet-core";
import { api as honoApi } from "@codex-worktime/timesheet-server";
import { api } from "~/lib/api";
import { projectColor } from "~/lib/colors";
import { downloadText } from "~/lib/export";
import { ProjectsPanel } from "~/components/ProjectsPanel";
import { DayList } from "~/components/DayList";
import { WeekGrid } from "~/components/WeekGrid";
import { MonthCalendar } from "~/components/MonthCalendar";
import { QuickEntry } from "~/components/QuickEntry";
import { ImportDialog } from "~/components/ImportDialog";
import { ExportDialog } from "~/components/ExportDialog";

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
    // 覆盖所选月与当月(±7 天冗余跨月周),保证月历与汇总卡同时正确
    const t = todayKey();
    const from = addDays(monthStart(data.date < monthStart(t) ? data.date : t), -7);
    const to = addDays(nextMonthFirst(data.date > t ? data.date : t), 7);
    const [projectsRes, entriesRes, tasksRes, totalRes] = await Promise.all([
      honoApi.request("/api/projects"),
      honoApi.request(`/api/entries?from=${from}&to=${to}`),
      honoApi.request("/api/tasks"),
      honoApi.request("/api/entries/total"),
    ]);
    return {
      projects: (await projectsRes.json()) as Project[],
      entries: (await entriesRes.json()) as Entry[],
      tasks: (await tasksRes.json()) as Task[],
      totalMinutes: ((await totalRes.json()) as { minutes: number }).minutes,
    };
  });

export const Route = createFileRoute("/")({
  validateSearch: (search) => searchSchema.parse(search),
  loaderDeps: ({ search: { date } }) => ({ date }),
  loader: ({ deps: { date } }) => loadTimesheet({ data: { date } }),
  component: AppShell,
});

function AppShell() {
  const { projects, entries, tasks, totalMinutes } = Route.useLoaderData();
  const { variant, date } = Route.useSearch();
  const router = useRouter();
  const [panelOpen, setPanelOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const active = projects.filter((p) => !p.archived);
  const refresh = () => void router.invalidate();

  const setSearch = (patch: { variant?: "week" | "day" | "month"; date?: string }) => {
    // 对象始终携带全量搜索参数;路由搜索类型的推导与 zod catch 有出入,单点断言
    void router.navigate({ search: { variant, date, ...patch } as never });
  };



  async function exportJson() {
    const [allEntries, allProjects, allTasks] = await Promise.all([
      api.listEntries(),
      api.listProjects(),
      api.listTasks(),
    ]);
    downloadText(
      `工时数据_${date.replaceAll("-", "")}.json`,
      JSON.stringify(
        { exportedAt: new Date().toISOString(), projects: allProjects, tasks: allTasks, entries: allEntries },
        null,
        2,
      ),
      "application/json",
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold">工时速记</h1>
          <span className="text-sm text-gray-500">手工登记外包项目投入</span>
        </div>
        <div className="flex items-center gap-2">
          <Chip color="accent" variant="soft" size="sm">
            总工时 {formatHours(totalMinutes)}
          </Chip>
          <Button size="sm" variant="ghost" onPress={() => setExportOpen(true)}>
            导出 XLSX
          </Button>
          <Button size="sm" variant="ghost" onPress={() => void exportJson()}>
            导出 JSON
          </Button>
          <Button size="sm" variant="ghost" onPress={() => setImportOpen(true)}>
            导入
          </Button>
          <Button size="sm" variant="ghost" onPress={() => setPanelOpen(true)}>
            项目 ⚙
          </Button>
        </div>
      </header>

      {active.length === 0 ? (
        <Card className="mt-10">
          <Card.Content className="p-10 text-center">
            <p className="text-base font-semibold">先在「项目 ⚙」里添加一个外包项目</p>
            <p className="mt-1 text-sm text-gray-400">
              项目只用于分组,不与任何 AI 时长数据关联
            </p>
          </Card.Content>
        </Card>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {active.map((p) => (
              <Chip key={p.id} size="sm" variant="soft">
                <span className="flex items-center gap-1.5 font-medium">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: projectColor(p.id) }}
                  />
                  {p.name}
                </span>
              </Chip>
            ))}
          </div>
          <SummaryCards
            entries={entries}
            totalMinutes={totalMinutes}
          />
          <QuickEntry
            date={date}
            projects={projects}
            tasks={tasks}
            onChanged={refresh}
          />
          <Tabs
            aria-label="视图切换"
            className="mt-4"
            selectedKey={variant}
            onSelectionChange={(key) =>
              key && setSearch({ variant: key as "week" | "day" | "month" })
            }
          >
            <Tabs.ListContainer>
              <Tabs.List>
                <Tabs.Tab id="week">
                  周网格
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="day">
                  日清单
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="month">
                  月日历
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>

          {variant === "day" && (
            <DayList
              date={date}
              projects={projects}
              entries={entries}
              onDateChange={(d) => setSearch({ date: d })}
              onChanged={refresh}
            />
          )}
          {variant === "week" && (
            <WeekGrid
              date={date}
              projects={projects}
              tasks={tasks}
              entries={entries}
              onDateChange={(d) => setSearch({ date: d })}
              onGotoDay={(d) => setSearch({ variant: "day", date: d })}
              onChanged={refresh}
            />
          )}
          {variant === "month" && (
            <MonthCalendar
              date={date}
              projects={projects}
              entries={entries}
              onDateChange={(d) => setSearch({ date: d })}
              onGotoDay={(d) => setSearch({ variant: "day", date: d })}
              onChanged={refresh}
            />
          )}
        </>
      )}

      <ExportDialog isOpen={exportOpen} onClose={() => setExportOpen(false)} />
      <ImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} onChanged={refresh} />

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

function SummaryCards({
  entries,
  totalMinutes,
}: {
  entries: Entry[];
  totalMinutes: number;
}) {
  const t = todayKey();
  const wkStart = startOfWeek(t);
  const wkEnd = addDays(wkStart, 6);
  const mStart = monthStart(t);
  const mEndNext = nextMonthFirst(t);
  const todayMin = entries.filter((e) => e.date === t).reduce((s, e) => s + e.minutes, 0);
  const weekMin = entries
    .filter((e) => e.date >= wkStart && e.date <= wkEnd)
    .reduce((s, e) => s + e.minutes, 0);
  const monthMin = entries
    .filter((e) => e.date >= mStart && e.date < mEndNext)
    .reduce((s, e) => s + e.minutes, 0);
  const card = (label: string, value: string) => (
    <Card className="flex-1">
      <Card.Header className="px-4 pt-3 pb-0 text-xs text-gray-400">{label}</Card.Header>
      <Card.Content className="px-4 pb-3 text-xl font-bold">{value}</Card.Content>
    </Card>
  );

  return (
    <div className="mt-4">
      <div className="flex gap-3">
        {card(`今日 ${dayOfWeekCN(t)}`, formatHours(todayMin))}
        {card("本周", formatHours(weekMin))}
        {card("本月", formatHours(monthMin))}
        {card("累计", formatHours(totalMinutes))}
      </div>
    </div>
  );
}
