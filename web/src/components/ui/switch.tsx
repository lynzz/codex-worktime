import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import { cn } from "~/lib/utils";

// 开关 + 文字标签(label 包裹,点文字也可切换)
export function Switch({
  checked,
  onCheckedChange,
  children,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("inline-flex cursor-default select-none items-center gap-2 text-sm text-zinc-700", className)}>
      <BaseSwitch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-zinc-300 p-0.5 outline-none transition-colors",
          "data-[checked]:bg-brand-600 focus-visible:ring-2 focus-visible:ring-brand-200",
        )}
      >
        <BaseSwitch.Thumb className="h-4 w-4 rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-4" />
      </BaseSwitch.Root>
      {children}
    </label>
  );
}
