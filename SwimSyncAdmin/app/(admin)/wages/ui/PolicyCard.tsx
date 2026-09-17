export function PolicyCard({
  rainPays,
  setRainPays,
  runDay,
  setRunDay,
  updateTenant,
}: {
  rainPays: boolean;
  setRainPays: (v: boolean) => void;
  runDay: number;
  setRunDay: (v: number) => void;
  updateTenant: (patch: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Policy</h2>
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={rainPays}
            onChange={async (e) => {
              setRainPays(e.target.checked);
              await updateTenant({ rain_pays_coach: e.target.checked });
            }}
          />
          Pay coaches for lessons cancelled by rain
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Pay coaches on day
          <input
            type="number"
            min={1}
            max={28}
            value={runDay}
            onChange={(e) => setRunDay(Number(e.target.value))}
            onBlur={async () => {
              const v = Math.min(28, Math.max(1, Math.trunc(runDay)));
              setRunDay(v);
              await updateTenant({ wage_run_day: v });
            }}
            className="w-16 rounded-lg border border-gray-200 px-2 py-1"
          />
          of the month
        </label>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        A lesson pays when at least one student attended. Everyone absent
        doesn&rsquo;t pay; a lesson the coach cancelled never does. Rain
        follows the setting above, and any single session can be overridden.
        Where a lesson was covered or shadowed (see Substitutes), each
        coach is paid their own rate and the coach they replaced is paid
        nothing for it — expand a payout below to see which lessons those are.
      </p>
    </div>
  );
}
