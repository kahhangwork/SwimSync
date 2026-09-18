import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { ContactHint } from "@/components/ContactHint";
import { checkSgPhone, checkEmail } from "@/lib/sgPhone";
import { formatSgDate } from "@/lib/lessonDates";
import type { TrialsState } from "../domain/useTrials";

export function BookTrialModal(p: { t: TrialsState }) {
  return (
    <Modal title="Book a trial" open={p.t.bookOpen} onClose={() => p.t.setBookOpen(false)}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Class</span>
          <select
            value={p.t.bookClass}
            onChange={(e) => {
              p.t.setBookClass(e.target.value);
              p.t.setBookDate("");
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Choose a class…</option>
            {p.t.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-gray-600">Lesson</span>
          <select
            value={p.t.bookDate}
            onChange={(e) => p.t.setBookDate(e.target.value)}
            disabled={!p.t.bookClass}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
          >
            <option value="">
              {p.t.bookClass ? "Choose a date…" : "Choose a class first"}
            </option>
            {p.t.datesFor(p.t.bookClass).map((d) => (
              <option key={d} value={d}>
                {formatSgDate(d)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-gray-400">
            Only the days this class actually runs.
          </span>
        </label>

        <div className="rounded-lg border border-gray-200 p-3">
          <p className="mb-2 text-xs font-semibold text-gray-600">Who is trying?</p>
          {p.t.eligible.length > 0 && (
            <label className="block mb-2">
              <span className="text-[11px] text-gray-500">
                A child already in SwimSync
              </span>
              <select
                value={p.t.bookExisting}
                onChange={(e) => p.t.setBookExisting(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">— someone new —</option>
                {p.t.eligible.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.full_name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-gray-400">
                Only children who aren&apos;t currently in a class.
              </span>
            </label>
          )}

          {!p.t.bookExisting && (
            <>
              <input
                value={p.t.bookName}
                onChange={(e) => p.t.setBookName(e.target.value)}
                placeholder="Child's name"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <input
                    value={p.t.bookPhone}
                    onChange={(e) => p.t.setBookPhone(e.target.value)}
                    placeholder="Parent's phone *"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  {/* Advisory only. The phone stays required — that guard
                      lives in handleBook() and is untouched — but a number
                      we don't recognise is still saved, because it may be
                      the only one the family gave. */}
                  <ContactHint check={checkSgPhone(p.t.bookPhone)} />
                </div>
                <div>
                  <input
                    value={p.t.bookEmail}
                    onChange={(e) => p.t.setBookEmail(e.target.value)}
                    placeholder="Parent's email (optional)"
                    type="email"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <ContactHint check={checkEmail(p.t.bookEmail)} />
                </div>
              </div>
              <p className="mt-1 text-[11px] text-gray-400">
                The phone is required: it is how this child is matched to
                their parent&apos;s account later, because names get written
                many different ways. The email is optional — it makes that
                match certain, and it is where an invite goes if they join.
              </p>
            </>
          )}
        </div>

        {p.t.bookError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {p.t.bookError}
          </p>
        )}

        <Button
          className="w-full"
          disabled={p.t.bookBusy || !p.t.bookClass || !p.t.bookDate}
          onClick={p.t.handleBook}
        >
          {p.t.bookBusy ? "Booking…" : "Book the trial"}
        </Button>
      </div>
    </Modal>
  );
}
