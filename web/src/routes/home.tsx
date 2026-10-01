import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { z } from "zod";
import {
  addDays,
  formatHours,
  monthStart,
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
import { RouteErrorBoundary } from "~/components/route-error";

const variantSchema = z.enum(["timeline", "cards", "waterfall"]).catch("timeline");

export const Route = createFileRoute("/home")({
  validateSearch: (s) => ({ variant: variantSchema.parse(s.variant) }),
  errorComponent: RouteErrorBoundary,
  loader: () => loadHome({ data: { date: todayKey() } }),
  component: HomePage,
});

// 装载:今天条目 + 外壳洞察栏所需范围(本周与本月) + 项目/任务 + 累计
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
  const wk = startOfWeek(t);
  const mS = monthStart(t);
  const from = wk < mS ? wk : mS;
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
    <div className="min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto w-full max-w-2xl min-w-0 px-4 pb-28 pt-4">
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm font-semibold">今天</span>
          <span className="text-xs text-zinc-400">{todays.length} 条</span>
          <span className="text-sm font-bold">{formatHours(todayMin)}</span>
          <div className="ml-auto flex gap-1 rounded-lg bg-zinc-100 p-0.5">
            {(["timeline", "cards", "waterfall"] as const).map((v) => (
              <button
                key={v}
                className={`rounded-md px-2.5 py-0.5 text-xs transition-colors ${
                  variant === v
                    ? "bg-white font-medium text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700"
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
          <p className="mt-20 text-center text-sm text-zinc-400">
            今天还没记录 — 底部输入一条试试
          </p>
        )}
      </div>
      {/* 底部:Thino 输入区 */}
      <Composer activeProjects={active} onDone={() => void router.invalidate()} />
    </div>
  );
}

// —— 底部输入区(单行自适应 + 实时解析回显)——
function Composer({
  activeProjects,
  onDone,
}: {
  activeProjects: Project[];
  onDone: () => void;
}) {
  const [projectId, setProjectId] = useState(activeProjects[0]?.id ?? "");
  const [raw, setRaw] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 实时解析:输入即回显(项目/时长/标题预览)
  const parsed = useMemo(() => parseLine(raw), [raw]);
  function parseLine(text: string) {
    let t = text.trim();
    let minutes = 0;
    let pid = projectId || (activeProjects[0]?.id ?? "");
    const durMatch = t.match(/(\d+(?:\.\d+)?h|\d+m|\d+:\d{2})(?=\s|$)/i);
    if (durMatch) {
      minutes = parseDurationInput(durMatch[1]) ?? 0;
      t = t.replace(durMatch[0], "").trim();
    }
    const tagMatch = t.match(/#(\S+)/);
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
        t = t.replace(tagMatch[0], "").trim();
      }
    }
    return { title: t, minutes, projectId: pid };
  }

  async function send() {
    if (!raw.trim()) return;
    if (!parsed.title) return setFlash("写点任务内容…"), void 0;
    if (!parsed.minutes) return setFlash("带上时长,如:1.5h / 90m / 1:30"), void 0;
    if (!parsed.projectId) return setFlash("项目还没加载好,稍后再试"), void 0;
    setBusy(true);
    setFlash("");
    try {
      await api.createEntry({
        date: todayKey(),
        projectId: parsed.projectId,
        title: parsed.title,
        minutes: parsed.minutes,
      });
      setRaw("");
      setFlash(`✓ 已记 ${formatHours(parsed.minutes)}`);
      setTimeout(() => setFlash(""), 2000);
      onDone();
    } catch (e) {
      setFlash((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // 高度自适应:1 行起步,内容多时自动长高(上限 4 行)
  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
  }

  // 始终展示,无需 open/close 状态
  const projName = activeProjects.find((p) => p.id === parsed.projectId)?.name ?? "";

  return (
    // 左缘与外壳对齐:图标轨 64px,lg 起再加洞察栏 288px
    <div className="fixed bottom-0 left-16 right-0 bg-gradient-to-t from-white via-white/95 to-transparent px-6 pb-4 pt-8 lg:left-[352px]">
      <div className="mx-auto flex max-w-2xl items-start gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 shadow-sm focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10">
        <textarea
          ref={taRef}
          rows={1}
          value={raw}
          placeholder="任务描述… 1.5h #项目(可选)"
          className="mt-1 min-h-[28px] w-full flex-1 resize-none self-stretch overflow-hidden border-none bg-transparent px-0 py-0.5 text-sm leading-7 outline-none placeholder:text-zinc-400"
          onChange={(e) => {
            setRaw(e.target.value);
            autoResize(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="primary"
              isDisabled={busy}
              onPress={() => void send()}
            >
              {busy ? <Spinner size="sm" /> : "记 ↵"}
            </Button>
          </div>
          {/* 实时解析回显:项目 · 时长 */}
          <div className="flex items-center gap-1 text-[11px] leading-none">
            <span className="text-zinc-400">{projName || "…"}</span>
            {parsed.minutes > 0 && (
              <span className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-600">
                {formatHours(parsed.minutes)}
              </span>
            )}
            {flash && <span className="text-brand-600">{flash}</span>}
          </div>
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
      <div className="absolute bottom-0 left-1 top-1 w-px bg-zinc-200" />
      {entries.map((e) => (
        <div key={e.id} className="group relative mb-3">
          <span
            className="absolute -left-[13px] top-1.5 h-2 w-2 rounded-full ring-2 ring-zinc-50"
            style={{ background: projectColor(e.projectId) }}
          />
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium tabular-nums text-zinc-400">
                {timeOf(e)}
              </span>
              <span className="text-sm">{e.title}</span>
              <span className="ml-auto text-xs font-bold">{formatHours(e.minutes)}</span>
              <button
                className="hidden text-zinc-300 hover:text-red-500 group-hover:block"
                aria-label="删除"
                onClick={() => onDelete(e.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-400">
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
          className="rounded-2xl border border-zinc-200 bg-white p-3"
          style={{ borderLeft: `3px solid ${projectColor(e.projectId)}` }}
        >
          <div className="text-xl font-extrabold">{formatHours(e.minutes)}</div>
          <div className="mt-1 truncate text-sm">{e.title}</div>
          <div className="mt-0.5 text-[11px] text-zinc-400">
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
          <div className="w-14 shrink-0 text-right text-xs font-bold text-zinc-500">
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
