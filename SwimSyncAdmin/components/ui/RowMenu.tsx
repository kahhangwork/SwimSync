"use client";

// DESIGN.md → Tables (admin): at most ONE inline action per row — the one the
// row's state calls for — and everything else in a row "…" menu (UI restyle
// Phase 5, first used by Credit notes in 5.2).
//
// Three things are deliberate, all for the UI drivers and the table box:
//  • Items are plain <button>s (role "button", NOT "menuitem") rendered INSIDE
//    the row's DOM, so a driver's `row.getByRole("button", { name: "Void" })`
//    still finds them once the menu is open — drivers open it through lib.mjs
//    `rowAction()`.
//  • The panel is `position: fixed`, placed from the trigger's rect: every
//    <Table> scrolls inside an `overflow-x-auto` box, which would clip an
//    absolutely-positioned panel on the last rows.
//  • Nothing renders when there are no items — callers pass only the actions
//    that apply, and an empty menu is not a menu.
import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export function RowMenu({
  children,
  label = "More actions",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || trigger.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  if (items.length === 0) return null;

  return (
    <span className="inline-flex">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        title={label}
        onClick={() => {
          if (open) return setPos(null);
          const r = trigger.current!.getBoundingClientRect();
          setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
        className="inline-flex h-[1.875rem] w-[1.875rem] items-center justify-center rounded-control border border-transparent text-ink-secondary transition-colors hover:border-border-strong hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          ref={panel}
          data-row-menu
          style={{ top: pos.top, right: pos.right }}
          // Any press inside closes it — the item's own onClick has already run.
          onClick={() => setPos(null)}
          className="fixed z-40 flex min-w-[10rem] flex-col rounded-card border border-border bg-surface py-1 shadow-float"
        >
          {items}
        </div>
      )}
    </span>
  );
}

/** One entry in a RowMenu. `destructive` draws it in Danger text — the
 *  confirmation step stays the caller's (DESIGN.md: always behind one). */
export function RowMenuItem({
  destructive,
  className,
  children,
  ...rest
}: { destructive?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "w-full px-3 py-1.5 text-left text-body transition-colors hover:bg-ground focus-visible:bg-ground focus-visible:outline-none disabled:cursor-not-allowed disabled:text-ink-muted",
        destructive ? "text-status-danger-text" : "text-ink",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
