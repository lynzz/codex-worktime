import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import { cn } from "~/lib/utils";

// 与原 HeroUI 复合 Tabs 同构;Indicator 不再需要(选中态由样式承担)
export const Tabs = Object.assign(
  function Tabs({
    selectedKey,
    onSelectionChange,
    children,
    className,
    "aria-label": ariaLabel,
  }: {
    selectedKey: string;
    onSelectionChange: (key: string) => void;
    children: React.ReactNode;
    className?: string;
    "aria-label"?: string;
  }) {
    return (
      <BaseTabs.Root
        value={selectedKey}
        onValueChange={(v) => v != null && onSelectionChange(String(v))}
      >
        <div className={className}>{children}</div>
      </BaseTabs.Root>
    );
  },
  {
    ListContainer: function ListContainer({ children }: { children: React.ReactNode }) {
      return <div>{children}</div>;
    },
    List: function List({ children }: { children: React.ReactNode }) {
      return (
        <BaseTabs.List className="inline-flex items-center gap-1 rounded-xl bg-gray-100/80 p-1">
          {children}
        </BaseTabs.List>
      );
    },
    Tab: function Tab({ id, children }: { id: string; children?: React.ReactNode }) {
      return (
        <BaseTabs.Tab
          value={id}
          className={cn(
            "cursor-default select-none rounded-lg px-3 py-1 text-sm text-gray-500 outline-none transition-colors",
            "hover:text-gray-700 aria-selected:bg-white aria-selected:text-gray-900 aria-selected:shadow-sm",
            "focus-visible:ring-2 focus-visible:ring-blue-200",
          )}
        >
          {children}
        </BaseTabs.Tab>
      );
    },
    Indicator: function Indicator() {
      return null;
    },
  },
);
