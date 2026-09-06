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
    "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
  secondary:
    "bg-gray-100 text-gray-900 hover:bg-gray-200",
  ghost:
    "text-gray-700 hover:bg-gray-100",
  tertiary:
    "text-blue-600 hover:bg-blue-50",
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
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-200",
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
