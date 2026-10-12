// DESIGN.md's status tag (UI restyle step 1.3): the five-step status scale, always
// a WORD — colour is never the only signal. Which status gets which tone is step
// 1.4's map, not this file's: a Tag only knows tones.
//
// Full literal class strings per tone, never `bg-status-${tone}-bg` — Tailwind
// purges what it cannot read whole (§7.191). lib/uiPrimitives.drift.test.ts holds it.
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "warning" | "danger" | "success";

const TONE: Record<Tone, string> = {
  neutral: "bg-status-neutral-bg text-status-neutral-text border-status-neutral-border",
  info: "bg-status-info-bg text-status-info-text border-status-info-border",
  warning: "bg-status-warning-bg text-status-warning-text border-status-warning-border",
  danger: "bg-status-danger-bg text-status-danger-text border-status-danger-border",
  success: "bg-status-success-bg text-status-success-text border-status-success-border",
};

const BASE = "inline-flex items-center rounded-tag border px-1.5 py-0.5 text-label font-medium";

/** Extra span props (`title`, `data-testid`) pass through — the sidebar's count
 *  badges carry both. */
export function Tag({ tone, className, children, ...rest }: { tone: Tone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn(BASE, TONE[tone], className)} {...rest}>
      {children}
    </span>
  );
}
