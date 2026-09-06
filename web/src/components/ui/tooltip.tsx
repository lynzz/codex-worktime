import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";

// 与原 HeroUI 复合 Tooltip 同构:
// <Tooltip><Tooltip.Trigger>…</Tooltip.Trigger><Tooltip.Content>…</Tooltip.Content></Tooltip>
export const Tooltip = Object.assign(
  function Tooltip({ children }: { children: React.ReactNode }) {
    return (
      <BaseTooltip.Provider delay={200}>
        <BaseTooltip.Root>{children}</BaseTooltip.Root>
      </BaseTooltip.Provider>
    );
  },
  {
    Trigger: function Trigger({ children }: { children: React.ReactNode }) {
      return <BaseTooltip.Trigger>{children}</BaseTooltip.Trigger>;
    },
    Content: function Content({ children }: { children: React.ReactNode }) {
      return (
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner sideOffset={6} className="z-50 outline-none">
            <BaseTooltip.Popup className="max-w-72 whitespace-pre-wrap rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs leading-5 text-gray-50 shadow-lg animate-fade-in">
              {children}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      );
    },
  },
);
