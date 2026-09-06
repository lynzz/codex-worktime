import { Link, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  CalendarRange,
  Database,
  FolderKanban,
  LayoutGrid,
  Timer,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
} from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

const NAV = [
  {
    label: "工时记录",
    items: [
      { to: "/week", title: "周网格", icon: LayoutGrid },
      { to: "/day", title: "日清单", icon: CalendarDays },
      { to: "/month", title: "月日历", icon: CalendarRange },
    ],
  },
  {
    label: "管理",
    items: [
      { to: "/projects", title: "项目与任务行", icon: FolderKanban },
      { to: "/data", title: "导入导出", icon: Database },
    ],
  },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <Sidebar>
      <SidebarHeader>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Timer className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">工时速记</div>
          <div className="text-xs text-gray-400">手工登记外包投入</div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const active = pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.title}
                  </Link>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
