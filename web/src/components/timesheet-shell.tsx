import { useEffect } from "react";
import { Card } from "~/components/ui";
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
import { useTotalHours } from "~/components/total-hours";
import type { TimesheetData } from "~/lib/timesheet-route";

// 三视图共用页壳:汇总卡 + 快速记录 + 视图内容
export function TimesheetShell({
  data,
  children,
}: {
  data: TimesheetData;
  children: React.ReactNode;
}) {
  const { set } = useTotalHours();
  useEffect(() => set(data.totalMinutes), [data.totalMinutes, set]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem-2rem)] max-w-[1400px] flex-col">
      <SummaryCards entries={data.entries} projects={data.projects.filter((p) => !p.archived)} />
      <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function SummaryCards({
  entries,
  projects,
}: {
  entries: TimesheetData["entries"];
  projects: TimesheetData["projects"];
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
  const allMin = entries.reduce((s, e) => s + e.minutes, 0);

  const card = (label: string, value: string) => (
    <Card className="flex-1">
      <Card.Header className="px-4 pt-3 pb-0 text-xs text-gray-400">{label}</Card.Header>
      <Card.Content className="px-4 pb-3 text-xl font-bold">{value}</Card.Content>
    </Card>
  );

  return (
    <div className="flex gap-3">
      {card(`今日 ${dayOfWeekCN(t)}`, formatHours(todayMin))}
      {card("本周", formatHours(weekMin))}
      {card("本月", formatHours(monthMin))}
      {card("当前范围", formatHours(allMin))}
    </div>
  );
}
