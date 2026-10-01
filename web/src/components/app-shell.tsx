import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarRange, Database, FolderKanban, MessageSquareText } from "lucide-react";
import {
  addDays,
  dayOfWeekCN,
  formatHours,
  monthStart,
  nextMonthFirst,
  startOfWeek,
  todayKey,
} from "@codex-worktime/timesheet-core";
import { projectColor } from "~/lib/colors";
import { DAY_MINUTES, laborCostYuan } from "~/lib/money";
import type { TimesheetData } from "~/lib/timesheet-route";
import { cn } from "~/lib/utils";

const NAV = [
  { to: "/home", title: "今天", icon: MessageSquareText },
  { to: "/month", title: "月历", icon: CalendarRange },
  { to: "/projects", title: "项目", icon: FolderKanban },
  { to: "/data", title: "数据", icon: Database },
];

// 布局:64px 图标轨 + 288px 洞察栏(lg 起)+ 内容区;home 底部输入坞按同一偏移定位
export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // 带外壳的页面 loader 均返回 TimesheetData 形状(home 自载同形数据),外壳直接读叶子路由数据
  const data = useRouterState({
    select: (s) => s.matches[s.matches.length - 1]?.loaderData as TimesheetData | undefined,
  });

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <nav className="fixed inset-y-0 left-0 z-30 flex w-16 flex-col items-center gap-1 bg-brand-950 py-3">
        {/* 墨绿底 logo 与轨同色,加细描边分界 */}
        <img src="/favicon.svg" alt="工时速记" className="mb-3 h-9 w-9 rounded-lg ring-1 ring-white/15" />
        {NAV.map((n) => {
          const active = pathname === n.to;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "relative flex w-12 flex-col items-center gap-1 rounded-xl py-2 text-[10px] transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-brand-200/60 hover:bg-white/5 hover:text-brand-50",
              )}
            >
              {active && <span className="absolute -left-2 bottom-2 top-2 w-1 rounded-r bg-money-400" />}
              <n.icon className="h-[18px] w-[18px]" />
              {n.title}
            </Link>
          );
        })}
      </nav>

      {data && <InsightPanel data={data} />}

      <div className="flex min-h-screen flex-col pl-16 lg:pl-[352px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-100 bg-white/80 px-6 backdrop-blur">
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          {data && (
            <span className="ml-auto text-xs text-zinc-400">
              累计 <b className="font-semibold tabular-nums text-zinc-900">{formatHours(data.totalMinutes)}</b>
            </span>
          )}
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

// 常驻洞察栏:今日进度(对 8h 人天)、本周逐日、本月工时与费用、本月按项目
function InsightPanel({ data }: { data: TimesheetData }) {
  const t = todayKey();
  const wk = startOfWeek(t);
  const weekDates = WEEK_DAYS.map((_, i) => addDays(wk, i));
  const mS = monthStart(t);
  const mE = nextMonthFirst(t);
  let today = 0;
  let month = 0;
  const weekMin = [0, 0, 0, 0, 0, 0, 0];
  const byProject = new Map<string, number>();
  for (const e of data.entries) {
    if (e.date === t) today += e.minutes;
    const wi = weekDates.indexOf(e.date);
    if (wi >= 0) weekMin[wi]! += e.minutes;
    if (e.date >= mS && e.date < mE) {
      month += e.minutes;
      byProject.set(e.projectId, (byProject.get(e.projectId) ?? 0) + e.minutes);
    }
  }
  const projects = [...byProject]
    .map(([id, minutes]) => ({
      id,
      minutes,
      name: data.projects.find((p) => p.id === id)?.name ?? id.slice(0, 8),
    }))
    .sort((a, b) => b.minutes - a.minutes);
  const weekTotal = weekMin.reduce((s, m) => s + m, 0);
  const weekMax = Math.max(DAY_MINUTES, ...weekMin);
  const todayIdx = weekDates.indexOf(t);
  const pct = Math.min(1, today / DAY_MINUTES);
  const circumference = 2 * Math.PI * RING_R;

  return (
    <aside className="fixed inset-y-0 left-16 hidden w-72 flex-col gap-5 overflow-y-auto border-r border-zinc-200 bg-zinc-50 px-5 py-5 lg:flex">
      <div>
        <div className="text-xs text-zinc-400">
          {Number(t.slice(5, 7))}月{Number(t.slice(8))}日 {dayOfWeekCN(t)}
        </div>
        <div className="text-base font-semibold">今日进度</div>
      </div>
      <div className="flex items-center gap-4">
        <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90" aria-hidden>
          <circle cx="52" cy="52" r={RING_R} fill="none" strokeWidth="10" className="stroke-zinc-200" />
          <circle
            cx="52"
            cy="52"
            r={RING_R}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            className="stroke-brand-500 transition-[stroke-dashoffset] duration-500"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
          />
        </svg>
        <div>
          <div className="text-2xl font-semibold tabular-nums">{formatHours(today)}</div>
          <div className="text-xs text-zinc-400">/ 8h 人天 · {Math.round(pct * 100)}%</div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-zinc-500">本周</span>
          <span className="text-sm font-semibold tabular-nums">{formatHours(weekTotal)}</span>
        </div>
        <div className="mt-3 flex h-16 items-end gap-1">
          {weekMin.map((m, i) => (
            <div
              key={WEEK_DAYS[i]}
              className="flex h-full flex-1 items-end"
              title={`${weekDates[i]} · ${formatHours(m)}`}
            >
              <div
                className={cn(
                  "w-full rounded-sm",
                  i === todayIdx ? "bg-brand-500" : i > todayIdx ? "bg-zinc-100" : "bg-brand-200",
                )}
                style={{ height: `${Math.max(8, (m / weekMax) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex text-[10px] text-zinc-400">
          {WEEK_DAYS.map((d) => (
            <span key={d} className="flex-1 text-center">
              {d}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-white p-3 ring-1 ring-zinc-200">
          <div className="text-[11px] text-zinc-400">本月</div>
          <div className="text-lg font-semibold tabular-nums">{formatHours(month)}</div>
        </div>
        <div className="rounded-2xl bg-money-50 p-3 ring-1 ring-money-200">
          <div className="text-[11px] text-money-700/70">本月费用</div>
          <div className="text-lg font-semibold tabular-nums text-money-700">
            ¥{laborCostYuan(month).toLocaleString()}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-zinc-500">本月按项目</div>
        {projects.length === 0 && <p className="text-xs text-zinc-300">本月暂无记录</p>}
        {projects.map((p) => (
          <div key={p.id} className="mb-2.5">
            <div className="mb-1 flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full" style={{ background: projectColor(p.id) }} />
              <span className="flex-1 truncate text-zinc-600">{p.name}</span>
              <span className="font-medium tabular-nums">{formatHours(p.minutes)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200/70">
              <div
                className="h-full rounded-full"
                style={{ width: `${(p.minutes / month) * 100}%`, background: projectColor(p.id) }}
              />
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

const WEEK_DAYS = ["一", "二", "三", "四", "五", "六", "日"];
const RING_R = 42;
