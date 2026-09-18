import Link from "next/link";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { formatSgDate } from "@/lib/lessonDates";
import { KID_RESULTS_CAP } from "../constants";
import type { MakeupsState } from "../domain/useMakeups";

export function BookMakeupModal(p: { m: MakeupsState }) {
  return (
    <Modal title="Book a make-up" open={p.m.bookOpen} onClose={() => p.m.setBookOpen(false)}>
      <div className="space-y-4">
        <div>
          <span className="text-xs font-semibold text-gray-600">Child</span>
          {p.m.kid ? (
            // Chosen. One line naming child + class, and a Change control —
            // re-opening the search is how you un-pick.
            <div className="mt-1 flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
              <span className="text-sm text-sky-900">
                <span className="font-semibold">{p.m.kid.full_name}</span>
                <span className="text-sky-700">
                  {" "}
                  — {p.m.kid.home_classes.map((c) => c.title).join(" · ")}
                </span>
              </span>
              <button
                onClick={() => {
                  p.m.setBookKid("");
                  p.m.setBookClass("");
                  p.m.setBookDate("");
                }}
                className="rounded-lg border border-sky-300 px-2 py-0.5 text-xs font-semibold text-sky-700 hover:bg-white"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                placeholder="Search by child or class…"
                value={p.m.kidQuery}
                onChange={(e) => p.m.setKidQuery(e.target.value)}
                autoFocus
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                {p.m.kidMatches.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">
                    No enrolled child matches “{p.m.kidQuery}”.
                  </p>
                ) : (
                  p.m.kidMatches.slice(0, KID_RESULTS_CAP).map((k) => (
                    <button
                      key={k.id}
                      onClick={() => {
                        p.m.setBookKid(k.id);
                        p.m.setBookHome("");
                        p.m.setBookClass("");
                        p.m.setBookDate("");
                      }}
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sky-50"
                    >
                      <span className="font-medium text-gray-800">
                        {k.full_name}
                      </span>
                      <span className="shrink-0 text-xs text-gray-500">
                        {k.home_classes.map((c) => c.title).join(" · ")}
                      </span>
                    </button>
                  ))
                )}
                {p.m.kidMatches.length > KID_RESULTS_CAP && (
                  <p className="px-3 py-1.5 text-[11px] text-gray-400">
                    {p.m.kidMatches.length - KID_RESULTS_CAP} more — keep typing to
                    narrow it down.
                  </p>
                )}
              </div>
              <span className="mt-1 block text-[11px] text-gray-400">
                Only children currently enrolled in a class. The search matches
                the child&apos;s name or their class&apos;s name.
              </span>
            </>
          )}
        </div>

        {/* WHICH class this replaces. Only asked when the answer is not forced
            — a child with one class sees nothing here, exactly as before.
            book_makeup() refuses to guess for a multi-class child, and it is
            right to: the class chosen here is snapshotted onto the booking and
            prices the invoice line. */}
        {p.m.kid && p.m.kid.home_classes.length > 1 && (
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">
              Which class is this making up?
            </span>
            <select
              value={p.m.bookHome}
              onChange={(e) => {
                p.m.setBookHome(e.target.value);
                // The host list and the package advisory are both derived from
                // this, so a stale host choice would silently belong to the
                // wrong category.
                p.m.setBookClass("");
                p.m.setBookDate("");
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Choose the class they missed…</option>
              {p.m.kid.home_classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        )}

        {p.m.kid && p.m.kid.home_classes.length > 1 && !p.m.homeClass ? (
          <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {p.m.kid.full_name} is in {p.m.kid.home_classes.length} classes. Pick the one
            they missed and the rest of the form will follow.
          </p>
        ) : p.m.kid && p.m.homeClass && p.m.hostChoices.length === 0 ? (
          // No other class in this category to guest into. Two shapes reach
          // here: the private-coach one (only one class of its kind exists),
          // and — since Wave 2 — a child who is already in EVERY class of
          // their kind. Both have the same answer.
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-amber-800">
              No other class of the same kind to join.
            </p>
            <p className="mt-1 text-xs text-amber-700">
              {p.m.kid.home_classes.length > 1
                ? `${p.m.kid.full_name} is already in every class of this kind, so there is`
                : `${p.m.homeClass.title} is the only class of its kind, so there is`}{" "}
              nothing to guest into. Schedule an <strong>Extra lesson</strong>{" "}
              of the child&apos;s own class instead, on the{" "}
              <Link href="/classes" className="font-semibold underline">
                Classes
              </Link>{" "}
              page.
            </p>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">
                Class to join
              </span>
              <select
                value={p.m.bookClass}
                onChange={(e) => {
                  p.m.setBookClass(e.target.value);
                  p.m.setBookDate("");
                }}
                disabled={!p.m.bookKid}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
              >
                <option value="">
                  {p.m.bookKid ? "Choose a class…" : "Choose a child first"}
                </option>
                {p.m.hostChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-gray-400">
                Only classes of the same kind as the child&apos;s own.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Lesson</span>
              <select
                value={p.m.bookDate}
                onChange={(e) => p.m.setBookDate(e.target.value)}
                disabled={!p.m.bookClass}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
              >
                <option value="">
                  {p.m.bookClass ? "Choose a date…" : "Choose a class first"}
                </option>
                {p.m.datesFor(p.m.bookClass).map((d) => (
                  <option key={d} value={d}>
                    {formatSgDate(d)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-gray-400">
                The days this class runs, plus any extra lesson its admin has
                scheduled.
              </span>
            </label>
          </>
        )}

        {p.m.expiryWarning && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {p.m.expiryWarning}
          </p>
        )}

        {p.m.bookError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {p.m.bookError}
          </p>
        )}

        <Button
          className="w-full"
          disabled={p.m.bookBusy || !p.m.bookKid || !p.m.bookClass || !p.m.bookDate}
          onClick={p.m.handleBook}
        >
          {p.m.bookBusy ? "Booking…" : "Book the make-up"}
        </Button>
      </div>
    </Modal>
  );
}
