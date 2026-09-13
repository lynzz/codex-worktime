import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
// PROTOTYPE — Thino 风记录主页原型(丢弃式,分支 prototype/thino-home)
// 变体经 ?variant= 切换:timeline / cards / waterfall
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
import { api } from "~/lib/api";
import { projectColor } from "~/lib/colors";

const variantSchema = z
  .enum(["timeline", "cards", "waterfall"])
  .catch("timeline");

export const Route = createFileRoute("/thino")({
  validateSearch: (s) => ({ variant: variantSchema.parse(s.variant) }),
  component: ThinoHome,
});

type Draft = { projectId: string; title: string; duration: string };

function ThinoHome() {
  const { variant } = Route.useSearch();
  const navigate = useNavigate();
  // 就地拉数据(原型不走 server fn,避免 SSR 抖动干扰评审)
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [flash, setFlash] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    // 原型内加客户端重试(跨境抖动下单轮 Promise.all 易全灭)
    for (let i = 1; ; i++) {
      try {
        const [p, t, e] = await Promise.all([
          api.listProjects(),
          api.listTasks(),
          api.listEntries(),
        ]);
        setProjects(p); setTasks(t); setEntries(e);
        return;
      } catch {
        if (i >= 4) { setDraft(null); setFlash(""); return; }
        await new Promise((r) => setTimeout(r, 600 * i));
      }
    }
  };
  useEffect(() => { void load(); }, []);

  const active = projects.filter((p) => !p.archived);
  const today = todayKey();

  // 解析输入行:"任务标题 #项目 1.5h" 或 "1.5h 任务 #项目"(Thino 式行内标记)
  function parseLine(raw: string) {
    let text = raw.trim();
    let minutes = 0;
    let projectId = draft?.projectId ?? active[0]?.id ?? "";
    // 时长 token
    const durMatch = text.match(/(\d+(?:\.\d+)?h|\d+m|\d+:\d{2})(?=\s|$)/i);
    if (durMatch) {
      minutes = parseDurationInput(durMatch[1]) ?? 0;
      text = text.replace(durMatch[0], "").trim();
    }
    // 项目 token:#xxx(精确 > 前缀/包含模糊匹配)
    const tagMatch = text.match(/#(\S+)/);
    if (tagMatch) {
      const tag = tagMatch[1]!;
      const lower = tag.toLowerCase();
      const found = active.find(
        (p) =>
          p.name === tag ||
          p.name.toLowerCase() === lower ||
          p.name.toLowerCase().startsWith(lower) ||
          p.name.toLowerCase().includes(lower),
      );
      if (found) { projectId = found.id; text = text.replace(tagMatch[0], "").trim(); }
    }
    return { title: text, minutes, projectId };
  }

  async function send() {
    const raw = taRef.current?.value ?? "";
    if (!draft || !raw.trim()) return;
    const { title, minutes, projectId } = parseLine(raw);
    if (!title) { setFlash("写点任务内容…"); return; }
    if (!minutes) { setFlash("带上时长,如:1.5h / 90m / 1:30"); return; }
    if (!projectId) { setFlash("项目列表还没加载好,稍后再试"); return; }
    await api.createEntry({ date: today, projectId, title, minutes });
    if (taRef.current) taRef.current.value = "";
    setDraft(null);
    setFlash(`✓ 已记 ${formatHours(minutes)}`);
    setTimeout(() => setFlash(""), 2000);
    void load();
  }

  const todays = useMemo(
    () => entries.filter((e) => e.date === today).slice().reverse(),
    [entries, today],
  );
  const todayMin = todays.reduce((s, e) => s + e.minutes, 0);

  const switchVariant = (v: string) =>
    void navigate({ to: "/thino", search: { variant: v } as never });

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* 时间流主体 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶部条 */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 bg-white/80 px-4 py-2.5 backdrop-blur">
          <span className="text-sm font-semibold">今天</span>
          <span className="text-xs text-gray-400">{todays.length} 条</span>
          <span className="ml-auto text-sm font-bold">{formatHours(todayMin)}</span>
        </div>
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-32 pt-4">
        {variant === "timeline" && (
          <Timeline entries={todays} projects={projects} />
        )}
        {variant === "cards" && (
          <Cards entries={todays} projects={projects} />
        )}
        {variant === "waterfall" && (
          <Waterfall entries={todays} projects={projects} />
        )}
        {todays.length === 0 && (
          <p className="mt-20 text-center text-sm text-gray-400">
            今天还没记录 — 底部输入一条试试
          </p>
        )}
        {/* 原型状态面板 */}
        <pre className="mt-6 rounded-xl bg-gray-900 p-3 text-[11px] leading-4 text-gray-300">
{JSON.stringify({ variant, entries: todays.length, draft }, null, 1)}
        </pre>
        </main>
      </div>

      {/* 右侧热点图(GitHub contributions 风格) */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-l border-gray-200 bg-white px-4 py-4 xl:block">
        <Heatmap entries={entries} projects={projects} />
      </aside>

      {/* 底部输入区(Thino 核心) */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">
          {draft ? (
            <div className="flex flex-col gap-2 rounded-2xl border-2 border-blue-400 bg-white px-3 py-2 shadow-lg">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                {active.find((p) => p.id === draft.projectId)?.name}
                <span>·</span>
                <span>今天</span>
                <span>·</span>
                <span>支持 #项目 标记 / 行内时长</span>
              </div>
              <textarea
                ref={taRef}
                rows={2}
                autoFocus
                placeholder="任务描述… 1.5h(#项目 可选)"
                className="w-full resize-none bg-transparent text-sm outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="flex items-center gap-2">
                <select
                  className="h-7 rounded-lg border border-gray-200 bg-white px-1.5 text-xs"
                  value={draft.projectId}
                  onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}
                >
                  {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <span className="ml-auto text-xs text-blue-600">{flash}</span>
                <button
                  className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white"
                  onClick={() => void send()}
                >
                  记一笔 ↵
                </button>
                <button
                  className="rounded-lg px-2 py-1 text-xs text-gray-400"
                  onClick={() => setDraft(null)}
                >
                  收起
                </button>
              </div>
            </div>
          ) : (
            <button
              className="w-full rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 py-3 text-sm text-gray-400 hover:border-blue-300"
              onClick={() => setDraft({ projectId: active[0]?.id ?? "", title: "", duration: "" })}
            >
              ⌨ 记一笔工时…
            </button>
          )}
          {/* 变体切换浮动条 */}
          <div className="pointer-events-none fixed bottom-24 right-4 flex flex-col gap-1">
            <button className="pointer-events-auto rounded-full bg-gray-900/80 px-3 py-1 text-[11px] text-white" onClick={() => switchVariant("timeline")}>时间轴</button>
            <button className="pointer-events-auto rounded-full bg-gray-900/80 px-3 py-1 text-[11px] text-white" onClick={() => switchVariant("cards")}>卡片</button>
            <button className="pointer-events-auto rounded-full bg-gray-900/80 px-3 py-1 text-[11px] text-white" onClick={() => switchVariant("waterfall")}>瀑布</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// —— 右侧栏:热点图(GitHub contributions 风格,近 12 周)——
function Heatmap({ entries, projects }: { entries: Entry[]; projects: Project[] }) {
  const weeks = 12;
  const cells = useMemo(() => {
    // 以周一为首列,近 N 周 × 7 天
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
      {/* 按项目分色饼图条 */}
      <div className="mt-4 border-t border-gray-100 pt-3">
        <p className="mb-1.5 text-xs font-medium text-gray-500">按项目(全部时间)</p>
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
              <span className="flex-1 truncate text-gray-600">{projects.find((p) => p.id === pid)?.name ?? pid.slice(0, 8)}</span>
              <span className="font-medium">{formatHours(min)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

// —— 变体 1:时间轴(左侧竖线 + 录入时间)——
function Timeline({ entries, projects }: { entries: Entry[]; projects: Project[] }) {
  // 显示"多久前"(Thino 风格相对时间),服务端无 createdAt → 按条目顺序估算
  const ago = (idx: number) => {
    if (idx === 0) return "刚刚";
    return `${idx * 30}分钟前`; // 原型近似值,真实现接 createdAt
  };
  return (
    <div className="relative pl-4">
      <div className="absolute bottom-0 left-1 top-1 w-px bg-gray-200" />
      {entries.map((e, idx) => (
        <div key={e.id} className="relative mb-3">
          <span
            className="absolute -left-[13px] top-1.5 h-2 w-2 rounded-full ring-2 ring-gray-50"
            style={{ background: projectColor(e.projectId) }}
          />
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-gray-400 tabular-nums">{ago(idx)}</span>
              <span className="text-sm">{e.title}</span>
              <span className="ml-auto text-xs font-bold">{formatHours(e.minutes)}</span>
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

// —— 变体 2:卡片墙(小时数大字)——
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

// —— 变体 3:瀑布流(按条目占比染色块)——
function Waterfall({ entries, projects }: { entries: Entry[]; projects: Project[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-2">
          <div className="w-14 shrink-0 text-right text-xs font-bold text-gray-500">
            {formatHours(e.minutes)}
          </div>
          <div
            className="h-9 min-w-16 flex-1 rounded-lg px-3 text-sm leading-9"
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
