import * as React from "react";
import { cn } from "~/lib/utils";

// 页头右侧常驻总工时,由各页面 loader 数据回填
const Ctx = React.createContext<{ total: number; set: (v: number) => void }>({
  total: 0,
  set: () => {},
});

export function TotalHoursProvider({ children }: { children: React.ReactNode }) {
  const [total, set] = React.useState(0);
  const value = React.useMemo(() => ({ total, set }), [total]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTotalHours() {
  return React.useContext(Ctx);
}

export function TotalHoursChip() {
  const { total } = useTotalHours();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
      总工时 {Math.round((total / 60) * 100) / 100}h
    </span>
  );
}

export { cn };
