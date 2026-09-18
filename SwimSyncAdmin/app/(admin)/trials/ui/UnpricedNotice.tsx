import type { TrialsState } from "../domain/useTrials";

// The reminder. Shown while any category has no trial price, gone when they all
// do. No dismiss control and no "seen" flag: the data IS the state, so it
// cannot get out of sync, and it correctly returns if a new category is added
// later and left unpriced.
export function UnpricedNotice(p: { t: TrialsState }) {
  return (
    <>
      {p.t.unpriced.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            Set a price for {p.t.unpriced.length === 1 ? "this class type" : "these class types"}:{" "}
            {p.t.unpriced.map((c) => c.name).join(", ")}
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Until you do, a paid trial of those classes is charged at the
            class&apos;s own lesson price. Nothing is blocked — but it is
            probably not what you want to charge someone trying you out.
          </p>
        </div>
      )}
    </>
  );
}
