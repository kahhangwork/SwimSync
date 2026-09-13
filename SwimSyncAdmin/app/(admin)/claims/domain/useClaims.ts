// Parent Requests (claims) — all state and orchestration. The page composes
// this hook and renders.

import { useEffect, useState } from "react";
import { todayInSg } from "@/lib/lessonDates";
import { familyLessonsByParent } from "@/lib/packageCoverage";
import type { Claim } from "../types";
import * as rpc from "../dao/claims.rpc";
import { defaultClaimName, shouldApplyName, approveNotes } from "./claimNaming";
import { contestedStudentIds, partitionClaims } from "./claimsRows";

export function useClaims() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Claim | null>(null);
  // The name the child will carry after linking. Applied via rename_student()
  // AFTER a successful approve — see approve().
  const [nameChoice, setNameChoice] = useState("");
  const [showDecided, setShowDecided] = useState(false);
  const [pkgByParent, setPkgByParent] = useState<Map<string, number>>(new Map());

  // ⚠ RISK 1: the default is CERTAINTY-DEPENDENT. Pre-fill the parent's typed
  // name only when they CONFIRMED the child is theirs. On an `unsure` claim,
  // defaulting to the parent's string would let a blind Approve overwrite the
  // coach's roster name with an unverified guess. So `unsure` defaults to the
  // current roster name; applying the parent's name takes an explicit act.
  useEffect(() => {
    if (!confirming) return;
    setNameChoice(
      defaultClaimName(
        confirming.certainty,
        confirming.claimed_name,
        confirming.student_name
      )
    );
  }, [confirming]);

  async function loadAll() {
    setLoading(true);
    const { data, error } = await rpc.listClaims();

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setClaims((data ?? []) as Claim[]);
    setLoading(false);

    rpc.loadLiveBalances().then(({ data: live }) => {
      setPkgByParent(familyLessonsByParent(live ?? [], todayInSg()));
    });
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function approve(claim: Claim) {
    setBusy(claim.id);
    setError(null);
    const { data, error } = await rpc.approveClaim(claim.id);
    if (error) {
      setBusy(null);
      setConfirming(null);
      setError(error.message);
      return;
    }

    // ⚠ RISK 3: the LINK is now made — the irreversible half. Applying the
    // chosen name is a SEPARATE, retryable step, and a failure here must NOT
    // read as an approval failure: re-clicking Approve would throw "already
    // decided" and look like a deeper bug. approve_student_claim also fills a
    // missing DOB first, which can make this rename newly collide — so a clean
    // "linked, but name not applied" message is the correct outcome, not a stall.
    let renameError: string | null = null;
    if (shouldApplyName(nameChoice, claim.student_name)) {
      const { error: renameErr } = await rpc.renameStudent(
        claim.student_id,
        nameChoice.trim()
      );
      if (renameErr) renameError = renameErr.message;
    }

    setBusy(null);
    setConfirming(null);

    const r = Array.isArray(data) ? data[0] : data;
    const notes = approveNotes({
      studentName: claim.student_name,
      parentName: claim.parent_name,
      othersDeclined: r?.others_declined ?? 0,
      renameError,
    });
    if (notes.length) setError(notes.join(" "));
    await loadAll();
  }

  async function decline(claim: Claim) {
    setBusy(claim.id);
    setError(null);
    const { error } = await rpc.declineClaim(claim.id);
    setBusy(null);
    if (error) setError(error.message);
    await loadAll();
  }

  async function undo(claim: Claim) {
    setBusy(claim.id);
    setError(null);
    const { error } = await rpc.undoClaim(claim.id);
    setBusy(null);
    if (error) setError(error.message);
    await loadAll();
  }

  const { pending, decided } = partitionClaims(claims);
  const contested = contestedStudentIds(pending);

  return {
    loading,
    error,
    busy,
    confirming,
    setConfirming,
    nameChoice,
    setNameChoice,
    showDecided,
    setShowDecided,
    pkgByParent,
    approve,
    decline,
    undo,
    pending,
    decided,
    contested,
  };
}
