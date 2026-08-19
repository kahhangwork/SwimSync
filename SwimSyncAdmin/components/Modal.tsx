"use client";

import { X } from "lucide-react";

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** `md` (default, max-w-md) or `lg` (max-w-2xl) for two-column forms. */
  size?: "md" | "lg";
}

/**
 * The panel never exceeds the viewport: it is capped at 90vh and scrolls
 * INSIDE, so a tall form on a short laptop screen scrolls its own body with the
 * title and the page behind it fixed, instead of overflowing the window
 * (the Edit Class form did exactly that on a 13" MacBook, 2026-08-19).
 */
export function Modal({ title, open, onClose, children, size = "md" }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`relative z-10 flex w-full max-h-[90vh] flex-col rounded-2xl bg-white shadow-xl ${
          size === "lg" ? "max-w-2xl" : "max-w-md"
        }`}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
