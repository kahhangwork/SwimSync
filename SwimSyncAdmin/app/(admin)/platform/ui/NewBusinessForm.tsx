// The "Create a business" form. Stage 6 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md, markup verbatim from page.tsx
// lines 556-683.
//
// ⚠ THE TWO EMAIL INPUTS STAY IN THIS DOM ORDER — admin email, then confirm.
// verify-tenant-provisioning fills them positionally by `input[type="email"]`,
// so swapping them makes the driver type the confirmation into the address and
// the guard would pass on a mistyped invite.
//
// ⚠ There is NO "Type" field, and that is deliberate (2026-08-01) — see the
// comment on the form itself. The one checkbox is the only thing here that
// changes what gets created.

import type { Dispatch, SetStateAction } from "react";

type NewBiz = {
  businessName: string;
  adminName: string;
  adminEmail: string;
  adminEmailConfirm: string;
  isCoach: boolean;
};

export function NewBusinessForm({
  newBiz,
  setNewBiz,
  newBizError,
  creating,
  onSubmit,
  onCancel,
}: {
  newBiz: NewBiz;
  setNewBiz: Dispatch<SetStateAction<NewBiz>>;
  newBizError: string | null;
  creating: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
                  <form
            onSubmit={onSubmit}
            className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4"
          >
            <h3 className="text-sm font-semibold text-gray-900">
              Create a business
            </h3>
            <p className="mt-1 text-xs text-gray-600">
              This creates the business and emails its admin a link to set their
              password. The business is live — and its join code works — as soon
              as it is created.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Business name
                </label>
                <input
                  value={newBiz.businessName}
                  onChange={(e) =>
                    setNewBiz({ ...newBiz, businessName: e.target.value })
                  }
                  placeholder="Dolphin Swim Academy"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Admin&apos;s name
                </label>
                <input
                  value={newBiz.adminName}
                  onChange={(e) =>
                    setNewBiz({ ...newBiz, adminName: e.target.value })
                  }
                  placeholder="Marcus Tan"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              {/* THERE IS NO "TYPE" FIELD, and that is deliberate (2026-08-01).
                  This asked "Private coach or Swim school?" and then discarded
                  the answer: nothing in SwimSync branches on it. Worse, it
                  cannot be answered — a one-coach school that pays its owner a
                  wage and a private coach who takes none are IDENTICAL in the
                  data; the difference is intent, which no column can see and no
                  query can derive.
                  The question people actually have is "will anyone here be paid
                  nothing by mistake?", and that needs no type: an owner without
                  a rate is a choice, a STAFF coach without one is the mistake.
                  See PRD §7.13 — the distinction is data, not a rule. */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Admin&apos;s email
                </label>
                <input
                  type="email"
                  value={newBiz.adminEmail}
                  onChange={(e) =>
                    setNewBiz({ ...newBiz, adminEmail: e.target.value })
                  }
                  placeholder="marcus@example.com"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Confirm email
                </label>
                <input
                  type="email"
                  value={newBiz.adminEmailConfirm}
                  onChange={(e) =>
                    setNewBiz({
                      ...newBiz,
                      adminEmailConfirm: e.target.value,
                    })
                  }
                  placeholder="marcus@example.com"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>

            {/* This checkbox is the ONLY thing here that changes what is
                created: it decides whether a coaches row exists. A private coach
                is a tenant of ONE — they administer the business and teach in
                it — and a school's owner may teach too, so this is a real
                question with a real consequence, unlike the "Type" field that
                used to sit above it (removed 2026-08-01: nothing branched on it
                and no query could derive it). */}
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={newBiz.isCoach}
                onChange={(e) =>
                  setNewBiz({ ...newBiz, isCoach: e.target.checked })
                }
                className="rounded border-gray-300"
              />
              This person also teaches (give them a coach account too)
            </label>

            {newBizError && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {newBizError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
              >
                {creating ? "Creating…" : "Create & invite"}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
  );
}
