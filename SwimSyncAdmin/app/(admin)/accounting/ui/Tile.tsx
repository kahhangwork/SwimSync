export function Tile({
  label,
  value,
  sub,
  tone = "default",
  testid,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "muted" | "warn";
  testid?: string;
}) {
  const valueColor =
    tone === "warn"
      ? "text-status-warning-text"
      : tone === "muted"
        ? "text-ink-muted"
        : "text-ink";
  return (
    <div
      className="rounded-card border border-border bg-surface p-4"
      data-testid={testid}
    >
      <p className="text-body font-medium text-ink-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-label text-ink-muted">{sub}</p>}
    </div>
  );
}
