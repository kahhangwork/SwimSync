// Coaches page — all state and orchestration. The page composes this hook.

import { useEffect, useRef, useState } from "react";
import { todayInSg } from "@/lib/lessonDates";
import type { CoachRow } from "../types";
import * as repo from "../dao/coaches.repo";
import * as api from "../dao/coaches.api";
import {
  unmarkedOverrideLessons,
  type UnmarkedOverrideLesson,
} from "./coachDisableImpact";
import { replacementOptions, toCoachRows, toOverrideSessions } from "./coachesRows";

export function useCoaches() {
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  // Disable / reactivate (Wave 5 chunk 2). The RPC is the boundary — these
  // dialogs are the UX affordance, surfacing its refusals PLAINLY.
  const [disableModal, setDisableModal] = useState<CoachRow | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [impact, setImpact] = useState<UnmarkedOverrideLesson[] | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [reactivateModal, setReactivateModal] = useState<CoachRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const impactCoachRef = useRef<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    loadCoaches();
  }, []);

  async function loadCoaches() {
    setLoading(true);
    const { data } = await repo.loadCoaches();
    setCoaches(toCoachRows((data ?? []) as any[]));
    setLoading(false);
  }

  async function handleCreate() {
    if (!name || !email || !password) {
      setCreateError("Name, email and password are required.");
      return;
    }
    setCreating(true);
    setCreateError(null);

    const { ok, json } = await api.createCoach({ name, email, phone, password });
    if (!ok) {
      setCreateError(json.error ?? "Failed to create coach.");
      setCreating(false);
      return;
    }

    setCreating(false);
    setShowCreate(false);
    setName("");
    setEmail("");
    setPhone("");
    setPassword("");
    loadCoaches();
  }

  function openDisable(coach: CoachRow) {
    setDisableModal(coach);
    setReplacementId("");
    setActionError(null);
    setImpact(null);
    setImpactError(null);
    loadImpact(coach);
  }

  // The ⚠ RISK 8 list: PAST/TODAY lessons whose substitute override names this
  // coach and which are not fully marked. After the disable, only an ADMIN can
  // mark them — and an unmarked lesson blocks the whole invoice run, with no
  // override (PRD §7.7).
  async function loadImpact(coach: CoachRow) {
    impactCoachRef.current = coach.id;
    const isStale = () => impactCoachRef.current !== coach.id;
    try {
      const scRes = await repo.loadSessionCoaches(coach.id);
      if (scRes.error) throw scRes.error;

      const today = todayInSg();
      const sessions = toOverrideSessions((scRes.data ?? []) as any[], today);

      if (sessions.length === 0) {
        if (!isStale()) setImpact([]);
        return;
      }

      const classIds = [...new Set(sessions.map((s) => s.class_id))];
      const sessionIds = sessions.map((s) => s.id);
      const dates = [...new Set(sessions.map((s) => s.session_date))];

      const [enrRes, attRes, triRes, mkRes] = await Promise.all([
        repo.loadEnrolments(classIds),
        repo.loadAttendance(sessionIds),
        repo.loadTrials(classIds, dates),
        repo.loadMakeups(classIds, dates),
      ]);
      if (enrRes.error) throw enrRes.error;
      if (attRes.error) throw attRes.error;
      if (triRes.error) throw triRes.error;
      if (mkRes.error) throw mkRes.error;

      if (isStale()) return;
      setImpact(
        unmarkedOverrideLessons(
          sessions,
          enrRes.data ?? [],
          attRes.data ?? [],
          [...(triRes.data ?? []), ...(mkRes.data ?? [])],
          today
        )
      );
    } catch (e) {
      if (isStale()) return;
      // An unreadable list must not read as an empty one — the admin would
      // disable believing nothing falls to them.
      setImpactError(
        e instanceof Error ? e.message : "could not read the marking backlog"
      );
    }
  }

  async function handleDisable() {
    if (!disableModal) return;
    if (disableModal.class_titles.length > 0 && !replacementId) return;
    setActionBusy(true);
    setActionError(null);

    const { ok, json } = await api.disableCoach(
      disableModal.id,
      replacementId || null
    );
    setActionBusy(false);
    if (!ok) {
      setActionError(json.error ?? "Failed to disable the coach.");
      return;
    }
    setDisableModal(null);
    loadCoaches();
  }

  async function handleReactivate() {
    if (!reactivateModal) return;
    setActionBusy(true);
    setActionError(null);

    const { ok, json } = await api.reactivateCoach(reactivateModal.id);
    setActionBusy(false);
    if (!ok) {
      setActionError(json.error ?? "Failed to reactivate the coach.");
      return;
    }
    setReactivateModal(null);
    loadCoaches();
  }

  function openCreate() {
    setName("");
    setEmail("");
    setPhone("");
    setPassword("");
    setCreateError(null);
    setShowCreate(true);
  }

  function openReactivate(coach: CoachRow) {
    setActionError(null);
    setReactivateModal(coach);
  }

  return {
    coaches,
    loading,
    showCreate,
    setShowCreate,
    disableModal,
    setDisableModal,
    replacementId,
    setReplacementId,
    impact,
    impactError,
    reactivateModal,
    setReactivateModal,
    actionError,
    actionBusy,
    name,
    setName,
    email,
    setEmail,
    phone,
    setPhone,
    password,
    setPassword,
    creating,
    createError,
    handleCreate,
    openDisable,
    handleDisable,
    handleReactivate,
    openCreate,
    openReactivate,
    replacementOptions: replacementOptions(coaches, disableModal?.id),
  };
}
