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
    // 跨境抖动窗口可能超过单请求重试预算:整体再试两轮
    for (let attempt = 1; ; attempt++) {
      try {
        return await load(data.date);
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  });

async function load(date: string) {
  const t = todayKey();
  const from = addDays(monthStart(date < monthStart(t) ? date : t), -7);
  const to = addDays(nextMonthFirst(date > t ? date : t), 7);
  // 服务端内部直连 Hono:带内部凭证头(auth 中间件识别),不经浏览器 cookie
  const internalHeaders = { "x-internal-key": process.env.ACCESS_PASSWORD ?? "" };
  const [projectsRes, entriesRes, tasksRes, totalRes] = await Promise.all([
    honoApi.request("/api/projects", { headers: internalHeaders }),
    honoApi.request(`/api/entries?from=${from}&to=${to}`, { headers: internalHeaders }),
    honoApi.request("/api/tasks", { headers: internalHeaders }),
    honoApi.request("/api/entries/total", { headers: internalHeaders }),
  ]);
  const [projects, entries, tasks, total] = await Promise.all([
    projectsRes.json() as Promise<Project[]>,
    entriesRes.json() as Promise<Entry[]>,
    tasksRes.json() as Promise<Task[]>,
    totalRes.json() as Promise<{ minutes: number }>,
  ]);
  // Hono 4xx 返回 json 错误对象,识别并抛出
  if ([projects, entries, tasks].some((a) => !Array.isArray(a))) {
    throw new Error("加载数据失败(网络抖动,请刷新)");
  }
  return { projects, entries, tasks, totalMinutes: total.minutes };
}

export type TimesheetData = Awaited<ReturnType<typeof load>>;
