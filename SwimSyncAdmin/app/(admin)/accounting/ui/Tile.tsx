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
      ? "text-amber-600"
      : tone === "muted"
        ? "text-gray-400"
        : "text-gray-900";
  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-5"
      data-testid={testid}
    >
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  );
}
