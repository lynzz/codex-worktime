import * as React from "react";
import { cn } from "~/lib/utils";

export function Chip({
  className,
  children,
  size,
  variant,
  color,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & {
  size?: string;
  variant?: string;
  color?: string;
}) {
  void size; void variant; void color; // 兼容原 HeroUI props,样式统一
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
