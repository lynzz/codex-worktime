import { z } from "zod";
import { isRedirect, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
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

// 各页面路由共用的搜索参数与数据装载(home 也用:范围覆盖本周与本月)
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
    // 跨境抖动窗口可能超过单请求重试预算:整体再试两轮;未登录重定向不重试
    for (let attempt = 1; ; attempt++) {
      try {
        return await load(data.date);
      } catch (error) {
        if (isRedirect(error) || attempt >= 3) throw error;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 800 * attempt);
        await promise;
      }
    }
  });

async function load(date: string) {
  const t = todayKey();
  const from = addDays(monthStart(date < monthStart(t) ? date : t), -7);
  const to = addDays(nextMonthFirst(date > t ? date : t), 7);
  // 服务端直连 Hono:转发浏览器 cookie,由 auth 中间件按正常会话鉴权(SSR 与客户端导航的 RPC 同一路径)
  const headers = { cookie: getRequestHeader("cookie") ?? "" };
  const responses = await Promise.all([
    honoApi.request("/api/projects", { headers }),
    honoApi.request(`/api/entries?from=${from}&to=${to}`, { headers }),
    honoApi.request("/api/tasks", { headers }),
    honoApi.request("/api/entries/total", { headers }),
  ]);
  if (responses.some((r) => r.status === 401)) throw redirect({ to: "/login" });
  const [projectsRes, entriesRes, tasksRes, totalRes] = responses;
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
