import { LucideIcon } from "lucide-react";

interface Props {
  title: string;
  value: number | string;
  icon: LucideIcon;
  subtitle?: string;
}

// A Dashboard figure (UI restyle 5.8): a flat card, the number in Ink with
// tabular figures, the icon a quiet Ink Muted glyph. Colour is NOT used to tell
// tiles apart — DESIGN.md keeps colour for status, and a red "Outstanding
// Invoices" tile said "stuck" about a count that is often just Due.
export function MetricCard({ title, value, icon: Icon, subtitle }: Props) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-body font-medium text-ink-secondary">{title}</p>
        <Icon className="h-4 w-4 text-ink-muted" aria-hidden />
      </div>
      <p className="text-[1.75rem] font-semibold leading-tight tabular-nums text-ink">{value}</p>
      {subtitle && <p className="mt-1 text-label font-normal text-ink-muted">{subtitle}</p>}
    </div>
  );
}
