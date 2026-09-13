import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { z } from "zod";
import {
  addDays,
  formatHours,
  parseDurationInput,
  startOfWeek,
  todayKey,
  type Entry,
  type Project,
  type Task,
} from "@codex-worktime/timesheet-core";
import { api as honoApi } from "@codex-worktime/timesheet-server";
import { api } from "~/lib/api";
import { projectColor } from "~/lib/colors";
import { Button, Spinner, TextArea } from "~/components/ui";
import { HeroSelect } from "~/components/HeroSelect";
import { useTotalHours } from "~/components/total-hours";
import { RouteErrorBoundary } from "~/components/route-error";

const variantSchema = z.enum(["timeline", "cards", "waterfall"]).catch("timeline");

export const Route = createFileRoute("/home")({
  validateSearch: (s) => ({ variant: variantSchema.parse(s.variant) }),
  errorComponent: RouteErrorBoundary,
  loader: () => loadHome({ data: { date: todayKey() } }),
  component: HomePage,
});

// 装载:今天条目 + 热点图(12 周)范围 + 项目/任务 + 累计
const loadHome = createServerFn({ method: "GET" })
  .validator((d: { date: string }) => d)
  .handler(async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await load();
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  });

async function load() {
  const t = todayKey();
  const from = addDays(startOfWeek(t), -(11 * 7));
  const to = addDays(t, 1);
  const h = { "x-internal-key": process.env.ACCESS_PASSWORD ?? "" };
  const [projectsRes, entriesRes, tasksRes, totalRes] = await Promise.all([
    honoApi.request("/api/projects", { headers: h }),
    honoApi.request(`/api/entries?from=${from}&to=${to}`, { headers: h }),
    honoApi.request("/api/tasks", { headers: h }),
    honoApi.request("/api/entries/total", { headers: h }),
  ]);
  const [projects, entries, tasks, total] = await Promise.all([
    projectsRes.json() as Promise<Project[]>,
    entriesRes.json() as Promise<Entry[]>,
    tasksRes.json() as Promise<Task[]>,
    totalRes.json() as Promise<{ minutes: number }>,
  ]);
  if ([projects, entries, tasks].some((a) => !Array.isArray(a))) {
    throw new Error("加载数据失败(网络抖动,请刷新)");
  }
  return { projects, entries, tasks, totalMinutes: total.minutes };
}

function HomePage() {
  const data = Route.useLoaderData();
  const { variant } = Route.useSearch();
  const router = useRouter();
  const { set } = useTotalHours();
  useEffect(() => set(data.totalMinutes), [data.totalMinutes, set]);

  const active = data.projects.filter((p) => !p.archived);
  const today = todayKey();
  const todays = useMemo(
    () =>
      data.entries
        .filter((e) => e.date === today)
        .slice()
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
    [data.entries, today],
  );
  const todayMin = todays.reduce((s, e) => s + e.minutes, 0);

  const switchVariant = (v: "timeline" | "cards" | "waterfall") =>
    void router.navigate({ to: "/home", search: { variant: v } as never });

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      {/* 左:时间流 */}
      <div className="mx-auto w-full max-w-2xl min-w-0 flex-1 px-4 pb-28 pt-4">
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm font-semibold">今天</span>
          <span className="text-xs text-gray-400">{todays.length} 条</span>
          <span className="text-sm font-bold">{formatHours(todayMin)}</span>
          <div className="ml-auto flex gap-1 rounded-lg bg-gray-100 p-0.5">
            {(["timeline", "cards", "waterfall"] as const).map((v) => (
              <button
                key={v}
                className={`rounded-md px-2.5 py-0.5 text-xs transition-colors ${
                  variant === v
                    ? "bg-white font-medium text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => switchVariant(v)}
              >
                {v === "timeline" ? "时间轴" : v === "cards" ? "卡片" : "瀑布"}
              </button>
            ))}
          </div>
        </div>

        {variant === "timeline" && (
          <Timeline
            entries={todays}
            projects={data.projects}
            onDelete={(id) => void api.deleteEntry(id).then(() => router.invalidate())}
          />
        )}
        {variant === "cards" && <Cards entries={todays} projects={data.projects} />}
        {variant === "waterfall" && <Waterfall entries={todays} projects={data.projects} />}
        {todays.length === 0 && (
          <p className="mt-20 text-center text-sm text-gray-400">
            今天还没记录 — 底部输入一条试试
          </p>
        )}
      </div>

      {/* 右:热点图 */}
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-72 shrink-0 overflow-y-auto border-l border-gray-200 px-4 py-4 xl:block">
        <Heatmap entries={data.entries} projects={data.projects} />
      </aside>

      {/* 底部:Thino 输入区 */}
      <Composer activeProjects={active} onDone={() => void router.invalidate()} />
    </div>
  );
}

// —— 底部输入区 ——
function Composer({
  activeProjects,
  onDone,
}: {
  activeProjects: Project[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(activeProjects[0]?.id ?? "");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function parseLine(raw: string) {
    let text = raw.trim();
    let minutes = 0;
    let pid = projectId || activeProjects[0]?.id || "";
    const durMatch = text.match(/(\d+(?:\.\d+)?h|\d+m|\d+:\d{2})(?=\s|$)/i);
    if (durMatch) {
      minutes = parseDurationInput(durMatch[1]) ?? 0;
      text = text.replace(durMatch[0], "").trim();
    }
    const tagMatch = text.match(/#(\S+)/);
    if (tagMatch) {
      const tag = tagMatch[1]!;
      const lower = tag.toLowerCase();
      const found = activeProjects.find(
        (p) =>
          p.name === tag ||
          p.name.toLowerCase() === lower ||
          p.name.toLowerCase().startsWith(lower) ||
          p.name.toLowerCase().includes(lower),
      );
      if (found) {
        pid = found.id;
        text = text.replace(tagMatch[0], "").trim();
      }
    }
    return { title: text, minutes, projectId: pid };
  }

  async function send() {
    const raw = taRef.current?.value ?? "";
    if (!raw.trim()) return;
    const { title, minutes, projectId: pid } = parseLine(raw);
    if (!title) return setFlash("写点任务内容…"), void 0;
    if (!minutes) return setFlash("带上时长,如:1.5h / 90m / 1:30"), void 0;
    if (!pid) return setFlash("项目还没加载好,稍后再试"), void 0;
    setBusy(true);
    setFlash("");
    try {
      await api.createEntry({ date: todayKey(), projectId: pid, title, minutes });
      if (taRef.current) taRef.current.value = "";
      setFlash(`✓ 已记 ${formatHours(minutes)}`);
      setTimeout(() => setFlash(""), 2000);
      onDone();
    } catch (e) {
      setFlash((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white px-4 py-3 lg:pl-[248px]">
        <div className="mx-auto max-w-2xl">
          <button
            className="w-full rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 py-3 text-sm text-gray-400 transition-colors hover:border-blue-300"
            onClick={() => {
              setOpen(true);
              setTimeout(() => taRef.current?.focus(), 50);
            }}
          >
            ⌨ 记一笔工时…
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white px-4 py-3 lg:pl-[248px]">
      <div className="mx-auto flex max-w-2xl flex-col gap-2 rounded-2xl border-2 border-blue-400 bg-white px-3 py-2 shadow-lg">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <HeroSelect
            ariaLabel="项目"
            className="w-32"
            items={activeProjects.map((p) => ({ id: p.id, name: p.name }))}
            selectedKey={projectId || activeProjects[0]?.id || ""}
            onSelectionChange={setProjectId}
          />
          <span>· 今天 · 支持 #项目标记 与行内时长</span>
        </div>
        <TextArea
          ref={taRef}
          rows={2}
          placeholder="任务描述… 1.5h(#项目 可选)"
          className="border-none bg-transparent focus:ring-0"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-blue-600">{flash}</span>
          <Button
            className="ml-auto"
            size="sm"
            variant="primary"
            isDisabled={busy}
            onPress={() => void send()}
          >
            {busy ? <Spinner size="sm" /> : "记一笔 ↵"}
          </Button>
          <Button size="sm" variant="ghost" onPress={() => setOpen(false)}>
            收起
          </Button>
        </div>
      </div>
    </div>
  );
}

// —— 时间轴(录入时刻 + 悬停删除)——
function Timeline({
  entries,
  projects,
  onDelete,
}: {
  entries: Entry[];
  projects: Project[];
  onDelete: (id: string) => void;
}) {
  const timeOf = (e: Entry) =>
    e.createdAt
      ? new Date(e.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : "";
  return (
    <div className="relative pl-4">
      <div className="absolute bottom-0 left-1 top-1 w-px bg-gray-200" />
      {entries.map((e) => (
        <div key={e.id} className="group relative mb-3">
          <span
            className="absolute -left-[13px] top-1.5 h-2 w-2 rounded-full ring-2 ring-gray-50"
            style={{ background: projectColor(e.projectId) }}
          />
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium tabular-nums text-gray-400">
                {timeOf(e)}
              </span>
              <span className="text-sm">{e.title}</span>
              <span className="ml-auto text-xs font-bold">{formatHours(e.minutes)}</span>
              <button
                className="hidden text-gray-300 hover:text-red-500 group-hover:block"
                aria-label="删除"
                onClick={() => onDelete(e.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-0.5 text-[11px] text-gray-400">
              {projects.find((p) => p.id === e.projectId)?.name}
              {e.category ? ` · ${e.category}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// —— 卡片墙 ——
function Cards({ entries, projects }: { entries: Entry[]; projects: Project[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {entries.map((e) => (
        <div
          key={e.id}
          className="rounded-2xl border border-gray-200 bg-white p-3"
          style={{ borderLeft: `3px solid ${projectColor(e.projectId)}` }}
        >
          <div className="text-xl font-extrabold">{formatHours(e.minutes)}</div>
          <div className="mt-1 truncate text-sm">{e.title}</div>
          <div className="mt-0.5 text-[11px] text-gray-400">
            {projects.find((p) => p.id === e.projectId)?.name}
          </div>
        </div>
      ))}
    </div>
  );
}

// —— 瀑布(宽度=工时占比)——
function Waterfall({ entries, projects }: { entries: Entry[]; projects: Project[] }) {
  void projects;
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-2">
          <div className="w-14 shrink-0 text-right text-xs font-bold text-gray-500">
            {formatHours(e.minutes)}
          </div>
          <div
            className="h-9 min-w-16 flex-1 truncate rounded-lg px-3 text-sm leading-9"
            style={{
              flexGrow: e.minutes,
              background: `${projectColor(e.projectId)}18`,
              border: `1px solid ${projectColor(e.projectId)}45`,
            }}
          >
            {e.title}
          </div>
        </div>
      ))}
    </div>
  );
}

// —— 热点图(12 周 GitHub 风格)——
function Heatmap({ entries, projects }: { entries: Entry[]; projects: Project[] }) {
  const weeks = 12;
  const cells = useMemo(() => {
    const t = todayKey();
    const thisMonday = startOfWeek(t);
    const arr: { date: string; minutes: number }[][] = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const col: { date: string; minutes: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(thisMonday, -w * 7 + d);
        const minutes = entries
          .filter((e) => e.date === date)
          .reduce((s, e) => s + e.minutes, 0);
        col.push({ date, minutes });
      }
      arr.push(col);
    }
    return arr;
  }, [entries]);

  const max = Math.max(60, ...cells.flat().map((c) => c.minutes));
  const total = cells.flat().reduce((s, c) => s + c.minutes, 0);

  const level = (m: number) => {
    if (m === 0) return "bg-gray-100";
    const r = m / max;
    if (r <= 0.25) return "bg-blue-200";
    if (r <= 0.5) return "bg-blue-300";
    if (r <= 0.75) return "bg-blue-500";
    return "bg-blue-700";
  };

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold">热点图</span>
        <span className="text-xs text-gray-400">{formatHours(total)} / 12周</span>
      </div>
      <div className="flex gap-[3px]">
        {cells.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {col.map((c) => (
              <div
                key={c.date}
                className={`h-3.5 w-3.5 rounded-[3px] ${level(c.minutes)}`}
                title={`${c.date} · ${formatHours(c.minutes)}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-400">
        <span>少</span>
        <span className="h-3 w-3 rounded-[3px] bg-gray-100" />
        <span className="h-3 w-3 rounded-[3px] bg-blue-200" />
        <span className="h-3 w-3 rounded-[3px] bg-blue-300" />
        <span className="h-3 w-3 rounded-[3px] bg-blue-500" />
        <span className="h-3 w-3 rounded-[3px] bg-blue-700" />
        <span>多</span>
      </div>
      <div className="mt-4 border-t border-gray-100 pt-3">
        <p className="mb-1.5 text-xs font-medium text-gray-500">按项目(近12周)</p>
        {entries.length === 0 && <p className="text-xs text-gray-300">暂无数据</p>}
        {Object.entries(
          entries.reduce<Record<string, number>>((acc, e) => {
            acc[e.projectId] = (acc[e.projectId] ?? 0) + e.minutes;
            return acc;
          }, {}),
        )
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([pid, min]) => (
            <div key={pid} className="flex items-center gap-2 py-0.5 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: projectColor(pid) }}
              />
              <span className="flex-1 truncate text-gray-600">
                {projects.find((p) => p.id === pid)?.name ?? pid.slice(0, 8)}
              </span>
              <span className="font-medium">{formatHours(min)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
