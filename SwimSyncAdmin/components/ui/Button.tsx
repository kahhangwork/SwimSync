// DESIGN.md's buttons (UI restyle step 1.3). Beside the legacy
// components/Button until Phase 7 retires it — screens move one at a time.
//
// Every class string is a FULL literal in a Record: Tailwind keeps only a class
// it can read whole in the source, so `bg-${x}` is purged with no error (§7.191).
// lib/uiPrimitives.drift.test.ts reads this file and holds that.
//
// `destructive` is a LOOK, not a guard: the confirmation step is the caller's
// (a Modal — DESIGN.md: always behind a confirmation). The app's twin wires
// confirmAction in because RN has no modal of its own here.
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "link";
/** 36px admin control; `row` is the 30px button inside a table row. */
export type ButtonSize = "md" | "row";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white border-transparent hover:bg-primary-hover disabled:bg-status-neutral-bg disabled:text-ink-muted",
  secondary:
    "bg-surface text-ink border-border-strong hover:bg-ground disabled:bg-status-neutral-bg disabled:text-ink-muted disabled:border-transparent",
  destructive:
    "bg-surface text-status-danger-text border-border-strong hover:bg-status-danger-bg disabled:bg-status-neutral-bg disabled:text-ink-muted disabled:border-transparent",
  link: "text-primary border-transparent px-0 hover:underline underline-offset-2 disabled:text-ink-muted disabled:no-underline",
};

const SIZE: Record<ButtonSize, string> = {
  md: "h-9 px-4",
  row: "h-[1.875rem] px-3",
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-control border text-body font-semibold transition-colors disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "primary", size = "md", type = "button", className, children, ...rest }: Props) {
  return (
    <button type={type} className={cn(BASE, SIZE[size], VARIANT[variant], className)} {...rest}>
      {children}
    </button>
  );
}
