"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { formatSgDate } from "@/lib/lessonDates";

/**
 * Parent Requests — a parent saying "I think that child on your roster is mine".
 *
 * ⚠ APPROVING IS THE HIGHEST-BLAST-RADIUS ACTION IN THE ADMIN PANEL.
 * It attaches a parent account to a child, which hands them that child's
 * attendance, invoices and payment history. So this page is built around
 * giving the admin enough to actually decide, rather than around making the
 * decision fast:
 *
 *   • the parent's own words are shown NEXT TO the roster record, because the
 *     question is "are these the same child?" and one of the two alone cannot
 *     answer it;
 *   • the full name and date of birth are shown here — unlike the parent's
 *     side, which sees a masked version. The admin is entitled to their own
 *     business's data; the parent is not, until this is approved;
 *   • the lesson count is shown, because it is what makes the decision matter;
 *   • Approve is a two-step confirm naming BOTH parties.
 *
 * A parent with a pending request is BLOCKED from adding that child, so an
 * undecided queue is a family stuck at the door. Nothing emails the admin
 * about it — the sidebar badge is the whole notification.
 */

type Claim = {
  id: string;
  status: "pending" | "approved" | "declined" | "withdrawn";
  certainty: "confirmed" | "unsure";
  match_reason: string;
  created_at: string;
  decided_at: string | null;
  claimed_name: string;
  claimed_dob: string | null;
  student_id: string;
  student_name: string;
  student_dob: string | null;
  lessons: number;
  parent_name: string;
  parent_email: string;
  parent_phone: string | null;
};

function reasonLabel(reason: string): string {
  switch (reason) {
    case "phone":
      return "Their registered phone matches the contact number on this child";
    case "name_dob":
      return "Name and date of birth both match";
    case "name_only":
      return "Name is similar — no date of birth to check against";
    default:
      return reason;
  }
}

export default function ClaimsPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Claim | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  async function loadAll() {
    setLoading(true);

    // ⚠ AN RPC, NOT A JOIN, AND THE REASON IS NOT PERFORMANCE.
    // This page first read student_claims and embedded
    // `parents(profiles(full_name, email, phone))`. That returns the parent's
    // details under service role and NULL under the admin's own RLS, so every
    // requester showed as "—" on the one screen whose job is "who is asking?".
    //
    // profiles_select reaches a parent through tenant_serves_parent(), which
    // goes via their CHILDREN'S ENROLMENTS — and a parent who has redeemed the
    // join code but has no child yet is served by nobody. That is exactly the
    // parent who files a claim.
    //
    // list_student_claims() is SECURITY DEFINER and filters each row by
    // is_tenant_admin() against that claim's own tenant, so it exposes this
    // screen's data and nothing else. Caught by the UI driver; every RPC
    // underneath was already correct.
    const { data, error } = await supabase.rpc("list_student_claims");

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setClaims((data ?? []) as Claim[]);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function approve(claim: Claim) {
    setBusy(claim.id);
    setError(null);
    const { data, error } = await supabase.rpc("approve_student_claim", {
      p_claim_id: claim.id,
    });
    setBusy(null);
    setConfirming(null);
    if (error) {
      setError(error.message);
      return;
    }
    // Say what else happened. Approving silently closes any competing claim on
    // the same child, and an admin who is not told will go looking for it.
    const r = Array.isArray(data) ? data[0] : data;
    if (r?.others_declined > 0) {
      setError(
        `${claim.student_name} is now linked to ${claim.parent_name}. ` +
          `${r.others_declined} other request on this child was declined automatically.`
      );
    }
    await loadAll();
  }

  async function decline(claim: Claim) {
    setBusy(claim.id);
    setError(null);
    const { error } = await supabase.rpc("decline_student_claim", {
      p_claim_id: claim.id,
    });
    setBusy(null);
    if (error) setError(error.message);
    await loadAll();
  }

  async function undo(claim: Claim) {
    setBusy(claim.id);
    setError(null);
    const { error } = await supabase.rpc("undo_student_claim", {
      p_claim_id: claim.id,
    });
    setBusy(null);
    if (error) setError(error.message);
    await loadAll();
  }

  const pending = claims.filter((c) => c.status === "pending");
  const decided = claims.filter((c) => c.status !== "pending");

  // Two pending requests on ONE child is a conflict the admin must see BEFORE
  // choosing, not after — approving either one closes the other.
  const contested = new Set(
    pending
      .map((c) => c.student_id)
      .filter((id, i, arr) => arr.indexOf(id) !== i)
  );

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <PageHeader
        title="Parent Requests"
        subtitle="Parents asking to be linked to a child already on your roster"
      />

      {error && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">{error}</p>
        </div>
      )}

      {pending.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">Nothing waiting.</p>
          <p className="mt-1 text-xs text-gray-400">
            When a parent adds a child who looks like one already on your
            roster, their request appears here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-gray-200 bg-white p-5"
            >
              {contested.has(c.student_id) && (
                <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                  More than one parent has asked about this child. Approving one
                  declines the others — check carefully which is right.
                </p>
              )}

              <div className="grid gap-5 md:grid-cols-2">
                {/* What the parent typed */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    The parent says
                  </p>
                  <p className="mt-1 font-semibold text-gray-900">
                    {c.claimed_name}
                  </p>
                  <p className="text-sm text-gray-500">
                    {c.claimed_dob
                      ? `Born ${formatSgDate(c.claimed_dob, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}`
                      : "No date of birth given"}
                  </p>
                  <p className="mt-2 text-sm text-gray-700">{c.parent_name}</p>
                  <p className="text-sm text-gray-500">{c.parent_email}</p>
                  <p className="text-sm text-gray-500">
                    {c.parent_phone ?? "No phone on file"}
                  </p>
                  <p className="mt-2 text-xs text-gray-400">
                    {c.certainty === "confirmed"
                      ? "They said this IS their child"
                      : "They said they were NOT SURE"}{" "}
                    · asked{" "}
                    {formatSgDate(c.created_at.slice(0, 10), {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                </div>

                {/* What is actually on the roster */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    On your roster
                  </p>
                  <p className="mt-1 font-semibold text-gray-900">
                    {c.student_name}
                  </p>
                  <p className="text-sm text-gray-500">
                    {c.student_dob
                      ? `Born ${formatSgDate(c.student_dob, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}`
                      : "No date of birth recorded"}
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-700">
                    {c.lessons} lesson{c.lessons === 1 ? "" : "s"} recorded
                  </p>
                  <p className="mt-2 text-xs text-gray-400">
                    {reasonLabel(c.match_reason)}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex gap-2">
                <Button
                  onClick={() => setConfirming(c)}
                  disabled={busy === c.id}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  onClick={() => decline(c)}
                  disabled={busy === c.id}
                >
                  Not their child
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Already decided, including the way back ─────────────────────── */}
      {decided.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowDecided((s) => !s)}
            className="text-sm font-medium text-sky-600 hover:text-sky-700"
          >
            {showDecided ? "Hide" : "Show"} decided requests ({decided.length})
          </button>

          {showDecided && (
            <div className="mt-3 space-y-2">
              {decided.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{c.student_name}</span>{" "}
                      {c.status === "approved" ? "linked to" : "not linked to"}{" "}
                      <span className="font-medium">{c.parent_name}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {c.status}
                      {c.decided_at
                        ? ` · ${formatSgDate(c.decided_at.slice(0, 10), {
                            day: "numeric",
                            month: "short",
                          })}`
                        : ""}
                    </p>
                  </div>

                  {/* ⚠ THE WAY BACK. A tenant admin cannot unlink a parent from
                      a child by any other route — parent_students_delete covers
                      the parent and the platform admin only — so without this
                      button a mis-approval is permanent short of SQL. It
                      refuses once an invoice covers that child. */}
                  {c.status === "approved" && (
                    <Button
                      variant="outline"
                      onClick={() => undo(c)}
                      disabled={busy === c.id}
                    >
                      Undo this link
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Two-step confirm, naming BOTH parties ────────────────────────── */}
      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Link this child to this parent?"
      >
        {confirming && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Attach{" "}
              <span className="font-semibold">{confirming.student_name}</span>
              {confirming.lessons > 0 && (
                <> ({confirming.lessons} lesson
                {confirming.lessons === 1 ? "" : "s"} recorded)</>
              )}{" "}
              to{" "}
              <span className="font-semibold">{confirming.parent_name}</span>
              &apos;s account?
            </p>
            <p className="text-sm text-gray-500">
              They will be able to see this child&apos;s attendance and billing
              history, and future lessons will be invoiced to them. You can undo
              this from the decided list, until the child has been invoiced.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => approve(confirming)}
                disabled={busy === confirming.id}
              >
                {busy === confirming.id ? "Linking…" : "Yes, link them"}
              </Button>
              <Button variant="outline" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
