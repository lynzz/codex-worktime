import * as React from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { cn } from "~/lib/utils";

// 与原 HeroUI 复合 Modal 同构:
// <Modal isOpen onOpenChange><Modal.Backdrop><Modal.Container><Modal.Dialog>…
export const Modal = Object.assign(
  function Modal({
    isOpen,
    onOpenChange,
    children,
  }: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    return (
      <BaseDialog.Root open={isOpen} onOpenChange={onOpenChange}>
        {children}
      </BaseDialog.Root>
    );
  },
  {
    Backdrop: function Backdrop({ children }: { children?: React.ReactNode }) {
      return (
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/40 animate-fade-in" />
          {children}
        </BaseDialog.Portal>
      );
    },
    Container: function Container({ children }: { children: React.ReactNode }) {
      return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[12vh]">{children}</div>;
    },
    Dialog: function Dialog({ children, className }: { children: React.ReactNode; className?: string }) {
      return (
        <BaseDialog.Popup
          className={cn(
            "w-full max-w-lg rounded-2xl bg-white shadow-xl outline-none animate-zoom-in",
            className,
          )}
        >
          {children}
        </BaseDialog.Popup>
      );
    },
    Header: function Header({ children }: { children: React.ReactNode }) {
      return <div className="border-b border-gray-100 px-5 py-3 text-sm font-semibold">{children}</div>;
    },
    Body: function Body({ children }: { children: React.ReactNode }) {
      return <div className="p-5">{children}</div>;
    },
    Footer: function Footer({ children }: { children: React.ReactNode }) {
      return <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">{children}</div>;
    },
  },
);
