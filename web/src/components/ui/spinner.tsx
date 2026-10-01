import { Loader2 } from "lucide-react";
import { cn } from "~/lib/utils";

export function Spinner({ className, size }: { className?: string; size?: string }) {
  const dim = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return <Loader2 className={cn(dim, "animate-spin text-current", className)} />;
}
