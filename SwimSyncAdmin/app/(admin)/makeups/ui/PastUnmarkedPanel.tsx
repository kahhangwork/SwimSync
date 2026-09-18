import { formatSgDate } from "@/lib/lessonDates";
import type { MakeupsState } from "../domain/useMakeups";

// Past and unmarked: the half that matters. A forgotten make-up HOLDS THE
// BILLING MONTH OPEN (see the page header).
export function PastUnmarkedPanel(p: { m: MakeupsState }) {
  return (
    <>
      {p.m.past.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">
            {p.m.past.length} make-up{p.m.past.length === 1 ? "" : "s"} still need marking
          </p>
          <p className="mt-0.5 mb-3 text-xs text-red-700">
            These lessons have passed and the coach hasn&apos;t recorded them.
            The billing month stays open until they do — mark them in the coach
            app, or cancel the booking if the child never came.
          </p>
          <ul className="space-y-1">
            {p.m.past.map((b) => (
              <li key={b.id} className="flex items-center gap-3 text-xs text-gray-800">
                <span className="font-semibold">{b.student_name}</span>
                <span className="text-gray-500">
                  {b.class_title} · {formatSgDate(b.session_date)}
                </span>
                <button
                  onClick={() => p.m.handleCancel(b.id)}
                  className="ml-auto rounded-lg border border-gray-300 px-2 py-0.5 font-semibold text-gray-600 hover:bg-white"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
