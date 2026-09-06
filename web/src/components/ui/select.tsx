import * as React from "react";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { cn } from "~/lib/utils";

// 与原 HeroUI 复合 Select 同构(字符串 value):
// <Select selectedKey onSelectionChange><Select.Trigger/><Select.Popover><ListBox …>
export const Select = Object.assign(
  function Select({
    selectedKey,
    onSelectionChange,
    children,
    className,
    items,
    "aria-label": ariaLabel,
  }: {
    selectedKey: string;
    onSelectionChange: (key: string) => void;
    children: React.ReactNode;
    className?: string;
    items?: { value: string; label: string }[];
    "aria-label"?: string;
  }) {
    return (
      <BaseSelect.Root<string | null>
        value={selectedKey}
        onValueChange={(v) => v != null && onSelectionChange(v)}
        items={items}
      >
        <div className={className}>{children}</div>
      </BaseSelect.Root>
    );
  },
  {
    Trigger: function Trigger({ children }: { children?: React.ReactNode }) {
      return (
        <BaseSelect.Trigger className="flex h-8 w-full items-center justify-between gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-900 outline-none transition-colors hover:border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
          {children}
          <BaseSelect.Icon className="text-gray-400">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      );
    },
    Value: function Value() {
      return <BaseSelect.Value />;
    },
    Popover: function Popover({ children }: { children: React.ReactNode }) {
      return (
        <BaseSelect.Portal>
          <BaseSelect.Positioner sideOffset={6} className="z-50 outline-none">
            <BaseSelect.Popup className="max-h-72 min-w-[8rem] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg animate-zoom-in">
              {children}
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      );
    },
  },
);

// items + 函数子元素,或静态 ListBoxItem 列表
export function ListBox({
  items,
  children,
}: {
  items?: { id: string; name: string }[];
  children?: React.ReactNode | ((item: { id: string; name: string }) => React.ReactNode);
}) {
  if (items && typeof children === "function") {
    return <>{items.map((item) => children(item))}</>;
  }
  return <>{children}</>;
}

export function ListBoxItem({
  id,
  textValue,
  children,
}: {
  id?: string;
  textValue?: string;
  children?: React.ReactNode;
}) {
  return (
    <BaseSelect.Item
      value={id ?? textValue ?? ""}
      label={textValue}
      className={cn(
        "flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none",
        "data-[highlighted]:bg-gray-100 data-[highlighted]:outline-none",
        "data-[selected]:font-medium data-[selected]:text-gray-900",
      )}
    >
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}
