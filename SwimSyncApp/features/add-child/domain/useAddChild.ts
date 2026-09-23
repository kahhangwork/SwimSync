// The Add Child screen's state, the tenant load and the one write path
// (docs/refactor/BATCH_FGH_PLAN.md, App L-F). Moved VERBATIM from
// app/(parent)/home/add-child.tsx — state, store reads, the focus effect and both
// handlers in their original order; the two builders are dao calls now.
//
// ⚠ THE FOCUS EFFECT'S DEPS ARE BYTE-IDENTICAL ([]) and it is called
// unconditionally from the route (plan ⚠ R4). The claim flow's sequencing —
// review → check → candidates → claim/unsure/create — is unchanged (plan ⚠ R5).
import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { useAppStore } from "@/store/useAppStore";
import type { ClaimCandidate } from "@/lib/claimCandidates";
import { fetchActiveJoinedTenants } from "../dao/addChild.repo";
import { addChildOrClaim } from "../dao/addChild.rpc";
import type { JoinedTenant } from "../types";

export function useAddChild() {
  // Which business this child is being added to. A child belongs to exactly one
  // (students.tenant_id), and the parent may only pick from businesses they
  // have actually JOINED with a code — never a directory of every coach on the
  // platform, which would let a mis-tap put a child on a stranger's roster.
  const [tenants, setTenants] = useState<JoinedTenant[] | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("Male");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  // The candidate popup. `null` = not showing; the server decides whether it
  // appears at all, so there is no client-side rule here to get out of step.
  const [candidates, setCandidates] = useState<ClaimCandidate[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  // A last look before the record exists. Creating a child is close to
  // irreversible in this product — there is no delete, only "set inactive"
  // (PRD §7.14), because attendance and invoices hang off the row. So a typo
  // in a name or a date is something the family lives with, and the cost of
  // one extra tap is far below the cost of a permanent wrong record.
  const [reviewing, setReviewing] = useState(false);

  const session = useAppStore((s) => s.session);
  const showToast = useAppStore((s) => s.showToast);

  // Reloaded on focus, so returning from the join screen picks up a code the
  // parent has just redeemed without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // Only businesses this family is still ACTIVE with. A family the
        // business has marked inactive can still log in and read their history
        // — that is deliberate, their invoices are the record — but adding a
        // new child there would silently re-enter a business that has closed
        // them off. Re-entering the join code is the way back in, and it is
        // the business's own gate.
        //
        // Gated on `is_active = false` explicitly, never on absence-of-truthy:
        // a family with no rows at all is a NEW parent, and must land on the
        // "join a business" prompt rather than an error.
        const { data } = await fetchActiveJoinedTenants();
        if (cancelled) return;

        const list: JoinedTenant[] = (data ?? [])
          .map((r: any) => r.tenants)
          .filter(Boolean);
        setTenants(list);
        // One business is the overwhelmingly common case — select it rather
        // than making every parent tap a single-option picker.
        setTenantId((prev) => prev ?? (list.length === 1 ? list[0].id : null));
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function handleSave() {
    if (!tenantId) {
      showToast("Choose which coach or school this child is with.", "error");
      return;
    }
    if (!name.trim()) {
      showToast("Full name is required.", "error");
      return;
    }
    if (!dob.trim()) {
      showToast("Date of birth is required.", "error");
      return;
    }

    // Validate date format YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dob.trim())) {
      showToast("Date of birth must be in YYYY-MM-DD format.", "error");
      return;
    }

    // Confirm the details BEFORE anything is written. The duplicate check runs
    // after this, on the server — the two are separate questions: "is this what
    // you meant to type?" then "does your coach already have this child?".
    setReviewing(true);
  }

  /**
   * The ONE write path for adding a child.
   *
   * This used to be a plain INSERT into `students` plus a second INSERT into
   * `parent_students`. It is now a single RPC because the "has your coach
   * already added this child?" check has to happen BEFORE the insert, and a
   * check the client could skip is not a check — `students_insert` no longer
   * admits parents at all, so this is the only door.
   *
   * `mode` is the parent's answer:
   *   check           — first attempt; the server looks for candidates
   *   claim_confirmed — "yes, that's my child"   ─┐ both file a claim; NEITHER
   *   claim_unsure    — "not sure"               ─┘ attaches the child
   *   create_anyway   — "no, that's a different child"
   */
  async function submit(
    mode: "check" | "claim_confirmed" | "claim_unsure" | "create_anyway",
    candidateId?: string
  ) {
    setLoading(true);
    setReviewing(false);

    const { data, error } = await addChildOrClaim({
      p_tenant_id: tenantId,
      p_full_name: name.trim(),
      p_date_of_birth: dob.trim(),
      p_gender: gender.toLowerCase(),
      p_notes: notes.trim() || null,
      p_mode: mode,
      p_candidate_id: candidateId ?? null,
    });

    setLoading(false);

    if (error) {
      // A child is identified by name + date of birth within a business
      // (students_identity_uniq). Hitting it almost always means this child is
      // already registered — a parent tapping Save twice, or re-adding a child
      // they forgot they had.
      //
      // ⚠ BUT AFTER "no, a different child" IT IS A DEAD END, and the bare
      // "already registered" message gives no way out: the parent has just
      // been shown that record and said it was not theirs, and now cannot
      // create their own. Say what the two ways forward actually are. Reported
      // from production 2026-07-26.
      if (error.code === "23505" && mode === "create_anyway") {
        showToast(
          `A child called ${name.trim()} with that date of birth is already registered here. If that IS the child your coach showed you, go back and choose "Yes, that's my child" — otherwise check the spelling or the date of birth.`,
          "error"
        );
        return;
      }
      showToast(
        error.code === "23505"
          ? error.message
          : error.message || "Failed to add your child. Please try again.",
        "error"
      );
      return;
    }

    // RETURNS TABLE, so supabase-js hands back an array of one row.
    const result = Array.isArray(data) ? data[0] : data;

    if (result?.outcome === "candidates") {
      setCandidates((result.candidates ?? []) as ClaimCandidate[]);
      setChosen(null);
      return;
    }

    if (result?.outcome === "pending" || result?.outcome === "already_pending") {
      setCandidates(null);
      showToast(
        result.outcome === "pending"
          ? "Sent to your coach to confirm. We'll add your child once they do."
          : "You've already asked about this child — your coach is still checking.",
        "success"
      );
      router.back();
      return;
    }

    setCandidates(null);
    showToast(
      `${name.trim()}'s profile has been created. The admin will assign them to a class shortly.`,
      "success"
    );
    router.back();
  }

  return {
    tenants,
    tenantId,
    setTenantId,
    name,
    setName,
    dob,
    setDob,
    gender,
    setGender,
    notes,
    setNotes,
    loading,
    candidates,
    setCandidates,
    chosen,
    setChosen,
    reviewing,
    setReviewing,
    handleSave,
    submit,
  };
}
