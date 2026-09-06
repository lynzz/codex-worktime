import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import {
  addDays,
  monthStart,
  nextMonthFirst,
  todayKey,
  type Entry,
  type Project,
  type Task,
} from "@codex-worktime/timesheet-core";
import { api as honoApi } from "@codex-worktime/timesheet-server";

// 三个视图路由共用的搜索参数与数据装载
export const searchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(todayKey()),
});
export type TimesheetSearch = z.infer<typeof searchSchema>;

export const loadTimesheet = createServerFn({ method: "GET" })
  .validator((d: { date: string }) => d)
  .handler(async ({ data }) => {
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

export type TimesheetData = Awaited<ReturnType<typeof loadTimesheet>>;
