"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * A right-hand slide-over. Deliberately the same prop shape as Modal.tsx
 * (title / open / onClose / children) so the two read as siblings, and
 * deliberately no richer than it: no portal, no focus-trap library, no
 * animation framework. A new shared component's risk is what it invents.
 *
 * The one thing it adds over Modal is Esc-to-close, because a panel that
 * covers the right third of the screen with no visible page controls under it
 * is easy to get stuck in.
 */
interface Props {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function Drawer({ title, subtitle, open, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      {/* Panel — pinned right, full height, its own scroll */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-y-0 right-0 z-10 flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-float"
      >
        <div className="flex items-start justify-between border-b border-divider px-6 py-5">
          <div>
            <h2 className="text-headline font-semibold text-ink">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-body-secondary text-ink-secondary">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-control p-1.5 text-ink-muted transition-colors hover:bg-selected hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
