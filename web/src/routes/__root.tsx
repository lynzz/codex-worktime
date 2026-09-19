/// <reference types="vite/client" />
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { AppSidebar } from "~/components/app-sidebar";
import { TotalHoursChip, TotalHoursProvider } from "~/components/total-hours";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "工时速记" },
      {
        rel: "icon",
        href:
          "data:image/svg+xml," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2563eb"/><path d="M16 7a9 9 0 1 0 9 9h-2.5A6.5 6.5 0 1 1 16 9.5V13l5-4-5-4v2z" fill="#fff"/><path d="M15 11h2v6h-2z" fill="#fff"/><path d="M15 10h2v2h-2z" fill="#fff"/></svg>',
          ),
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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
  // 登录页独立布局(无侧栏/页头)
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
        <TotalHoursProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-gray-200 bg-white/80 px-4 backdrop-blur">
              <SidebarTrigger />
              <div className="h-4 w-px bg-gray-200" />
              <h1 className="text-sm font-semibold">{TITLES[pathname] ?? "工时速记"}</h1>
              <div className="ml-auto">
                <TotalHoursChip />
              </div>
            </header>
            <main className="flex-1 p-4 md:p-6">
              <Outlet />
            </main>
          </SidebarInset>
        </SidebarProvider>
        </TotalHoursProvider>
        <Scripts />
      </body>
    </html>
  );
}
