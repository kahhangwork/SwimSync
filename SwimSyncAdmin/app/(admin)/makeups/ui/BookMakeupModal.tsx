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
          <span className="text-label font-semibold text-ink-secondary">Child</span>
          {p.m.kid ? (
            // Chosen. One line naming child + class, and a Change control —
            // re-opening the search is how you un-pick.
            <div className="mt-1 flex items-center justify-between rounded-card border border-status-info-border bg-status-info-bg px-3 py-2">
              <span className="text-body text-status-info-text">
                <span className="font-semibold">{p.m.kid.full_name}</span>
                <span className="text-primary">
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
                className="rounded-control border border-border-strong bg-surface px-2 py-0.5 text-label font-semibold text-ink hover:bg-ground"
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
                className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="mt-1 max-h-56 overflow-y-auto rounded-control border border-border divide-y divide-divider">
                {p.m.kidMatches.length === 0 ? (
                  <p className="px-3 py-2 text-label text-ink-muted">
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
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-body hover:bg-ground"
                    >
                      <span className="font-medium text-ink">
                        {k.full_name}
                      </span>
                      <span className="shrink-0 text-label text-ink-muted">
                        {k.home_classes.map((c) => c.title).join(" · ")}
                      </span>
                    </button>
                  ))
                )}
                {p.m.kidMatches.length > KID_RESULTS_CAP && (
                  <p className="px-3 py-1.5 text-label text-ink-muted">
                    {p.m.kidMatches.length - KID_RESULTS_CAP} more — keep typing to
                    narrow it down.
                  </p>
                )}
              </div>
              <span className="mt-1 block text-label text-ink-muted">
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
            <span className="text-label font-semibold text-ink-secondary">
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
              className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body"
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
          <p className="rounded-control border border-border bg-ground px-3 py-2 text-label text-ink-secondary">
            {p.m.kid.full_name} is in {p.m.kid.home_classes.length} classes. Pick the one
            they missed and the rest of the form will follow.
          </p>
        ) : p.m.kid && p.m.homeClass && p.m.hostChoices.length === 0 ? (
          // No other class in this category to guest into. Two shapes reach
          // here: the private-coach one (only one class of its kind exists),
          // and — since Wave 2 — a child who is already in EVERY class of
          // their kind. Both have the same answer.
          <div className="rounded-card border border-status-warning-border bg-status-warning-bg px-3 py-2.5">
            <p className="text-label font-semibold text-status-warning-text">
              No other class of the same kind to join.
            </p>
            <p className="mt-1 text-label text-status-warning-text">
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
              <span className="text-label font-semibold text-ink-secondary">
                Class to join
              </span>
              <select
                value={p.m.bookClass}
                onChange={(e) => {
                  p.m.setBookClass(e.target.value);
                  p.m.setBookDate("");
                }}
                disabled={!p.m.bookKid}
                className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body disabled:bg-ground"
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
              <span className="mt-1 block text-label text-ink-muted">
                Only classes of the same kind as the child&apos;s own.
              </span>
            </label>

            <label className="block">
              <span className="text-label font-semibold text-ink-secondary">Lesson</span>
              <select
                value={p.m.bookDate}
                onChange={(e) => p.m.setBookDate(e.target.value)}
                disabled={!p.m.bookClass}
                className="mt-1 w-full rounded-control border border-border-strong px-3 py-2 text-body disabled:bg-ground"
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
              <span className="mt-1 block text-label text-ink-muted">
                The days this class runs, plus any extra lesson its admin has
                scheduled.
              </span>
            </label>
          </>
        )}

        {p.m.expiryWarning && (
          <p className="rounded-card border border-status-warning-border bg-status-warning-bg px-3 py-2 text-label text-status-warning-text">
            {p.m.expiryWarning}
          </p>
        )}

        {p.m.bookError && (
          <p className="rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-label text-status-danger-text">
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
