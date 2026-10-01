/// <reference types="vite/client" />
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { AppShell } from "~/components/app-shell";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "工时速记" },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootComponent,
});

const TITLES: Record<string, string> = {
  "/home": "今天",
  "/month": "月历",
  "/projects": "项目与任务行",
  "/data": "导入导出",
};

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // 登录页独立布局(无导航/页头)
  if (pathname === "/login") {
    return (
      <html lang="zh-CN">
        <head>
          <HeadContent />
        </head>
        <body>
          <Outlet />
          <Scripts />
        </body>
      </html>
    );
  }
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppShell title={TITLES[pathname] ?? "工时速记"}>
          <Outlet />
        </AppShell>
        <Scripts />
      </body>
    </html>
  );
}
