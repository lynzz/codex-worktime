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
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⏱️</text></svg>',
          ),
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

const TITLES: Record<string, string> = {
  "/week": "周网格",
  "/day": "日清单",
  "/month": "月日历",
  "/projects": "项目与任务行",
  "/data": "导入导出",
};

function RootComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
