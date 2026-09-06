import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { cn } from "~/lib/utils";

// 精简 shadcn sidebar(Base UI 实现):桌面浮动侧栏 + 移动端抽屉
type SidebarCtx = {
  open: boolean;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
};
const Ctx = React.createContext<SidebarCtx | null>(null);

export function useSidebar() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useSidebar 必须在 SidebarProvider 内使用");
  return ctx;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const value = React.useMemo(
    () => ({ open, toggle: () => setOpen((v) => !v), mobileOpen, setMobileOpen }),
    [open, mobileOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function Sidebar({ children }: { children: React.ReactNode }) {
  const { open, mobileOpen, setMobileOpen } = useSidebar();
  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-2 left-2 z-30 hidden w-60 flex-col rounded-2xl border border-gray-200 bg-white shadow-sm transition-transform duration-200 md:flex",
          !open && "-translate-x-[calc(100%+16px)]",
        )}
      >
        {children}
      </aside>
      <BaseDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          <BaseDialog.Popup className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white shadow-xl outline-none">
            {children}
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>
    </>
  );
}

export function SidebarHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex items-center gap-2 border-b border-gray-100 px-4 py-3.5", className)}>{children}</div>;
}

export function SidebarContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex-1 overflow-y-auto px-2 py-2", className)}>{children}</div>;
}

export function SidebarFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("border-t border-gray-100 p-3", className)}>{children}</div>;
}

export function SidebarGroup({ children }: { children: React.ReactNode }) {
  return <div className="mb-3">{children}</div>;
}

export function SidebarGroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-xs font-medium text-gray-400">{children}</div>;
}

export function SidebarMenu({ children }: { children: React.ReactNode }) {
  return <nav className="flex flex-col gap-0.5">{children}</nav>;
}

export function SidebarInset({ children }: { children: React.ReactNode }) {
  const { open } = useSidebar();
  return (
    <div className={cn("flex min-h-screen flex-col transition-[padding] duration-200", open ? "md:pl-[244px]" : "md:pl-0")}>
      {children}
    </div>
  );
}

export function SidebarTrigger({ className }: { className?: string }) {
  const { toggle, setMobileOpen } = useSidebar();
  return (
    <button
      type="button"
      aria-label="切换侧栏"
      onClick={() => {
        if (window.matchMedia("(min-width: 768px)").matches) toggle();
        else setMobileOpen(true);
      }}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100",
        className,
      )}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
      </svg>
    </button>
  );
}
