import * as React from "react";
import { cn } from "~/lib/utils";

export const Card = Object.assign(
  function Card({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
      <div className={cn("rounded-xl border border-gray-200 bg-white", className)}>
        {children}
      </div>
    );
  },
  {
    Header: function Header({ className, children }: { className?: string; children: React.ReactNode }) {
      return <div className={cn("px-4 pt-3 pb-0 text-xs text-gray-400", className)}>{children}</div>;
    },
    Content: function Content({ className, children }: { className?: string; children: React.ReactNode }) {
      return <div className={cn("px-4 pb-3 text-xl font-bold", className)}>{children}</div>;
    },
  },
);
