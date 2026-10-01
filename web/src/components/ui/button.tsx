import * as React from "react";
import { cn } from "~/lib/utils";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "tertiary"
  | "danger-soft";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800",
  secondary:
    "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
  ghost:
    "text-zinc-700 hover:bg-zinc-100",
  tertiary:
    "text-brand-600 hover:bg-brand-50",
  "danger-soft":
    "text-red-600 bg-red-50 hover:bg-red-100",
};

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onPress"> {
  variant?: Variant;
  size?: "sm" | "md";
  isDisabled?: boolean;
  onPress?: () => void;
}

export function Button({
  variant = "primary",
  size = "md",
  isDisabled,
  onPress,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onPress}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-200",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
