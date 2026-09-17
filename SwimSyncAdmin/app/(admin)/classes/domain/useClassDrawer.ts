import { useEffect, useState } from "react";
import * as repo from "../dao/classes.repo";
import * as rpc from "../dao/classes.rpc";
import type { ClassRow, Coach, ShadowAssignment } from "../types";

/**
 * The roster drawer's selection + its shadow-coach management. Takes the shared
 * `coaches` spine (from useClassList) for the name lookup and the rate warning.
 */
export function useClassDrawer(coaches: Coach[]) {
  const [drawerClass, setDrawerClass] = useState<ClassRow | null>(null);
  const [shadows, setShadows] = useState<ShadowAssignment[]>([]);
  const [shadowPick, setShadowPick] = useState("");
  const [shadowFrom, setShadowFrom] = useState("");
  const [shadowBusy, setShadowBusy] = useState(false);
  const [shadowError, setShadowError] = useState<string | null>(null);

  // ⚠ RISK 7 — deps are load-bearing, do NOT widen to satisfy exhaustive-deps.
  // The drawer's shadow list follows whichever class is open. Cleared on close
  // so the next class cannot flash the previous one's assignments. `?.id` (not
  // the object) stops a refetch on every list reload; `coaches.length` re-runs
  // loadShadows once coaches arrive, else every name is "Unknown coach".
  useEffect(() => {
    if (drawerClass) loadShadows(drawerClass.id);
    else {
      setShadows([]);
      setShadowPick("");
      setShadowFrom("");
      setShadowError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerClass?.id, coaches.length]);

  /**
   * Who shadows the class currently open in the drawer, and who used to.
   *
   * ⚠ ENDED ASSIGNMENTS ARE SHOWN, NOT HIDDEN. An ended one still explains
   * money: pay asks "was this coach assigned on the LESSON's date", so a coach
   * who stopped shadowing in August is still paid for August and an admin
   * looking at that payout needs to see why. Hiding history here would make the
   * Wages page unexplainable.
   */
  async function loadShadows(classId: string) {
    setShadowError(null);
    const { data, error } = await repo.loadShadows(classId);

    if (error) {
      // A failed load must NOT render as "nobody shadows this class" — that is
      // the state an admin would then try to create, and the second assignment
      // is refused by the unique index in a way that reads as a bug.
      setShadowError(error.message);
      setShadows([]);
      return;
    }
    setShadows(
      (data ?? []).map((r: any) => ({
        id: r.id,
        coach_id: r.coach_id,
        coach_name:
          coaches.find((c) => c.id === r.coach_id)?.full_name ?? "Unknown coach",
        effective_from: r.effective_from,
        effective_to: r.effective_to,
      }))
    );
  }

  async function handleAssignShadow() {
    if (!drawerClass || !shadowPick) {
      setShadowError("Choose a coach first.");
      return;
    }
    setShadowBusy(true);
    setShadowError(null);
    const { error } = await rpc.assignClassShadow({
      p_class_id: drawerClass.id,
      p_coach_id: shadowPick,
      p_effective_from: shadowFrom || null,
    });
    if (error) {
      setShadowBusy(false);
      setShadowError(error.message);
      return;
    }
    setShadowPick("");
    setShadowFrom("");
    await loadShadows(drawerClass.id);
    setShadowBusy(false);
  }

  async function handleEndShadow(coachId: string) {
    if (!drawerClass) return;
    setShadowBusy(true);
    setShadowError(null);
    // ⚠ END, never DELETE — rpc.endClassShadow carries the full reasoning.
    const { error } = await rpc.endClassShadow({
      p_class_id: drawerClass.id,
      p_coach_id: coachId,
      p_effective_to: null,
    });
    if (error) {
      setShadowBusy(false);
      setShadowError(error.message);
      return;
    }
    await loadShadows(drawerClass.id);
    setShadowBusy(false);
  }

  return {
    drawerClass,
    setDrawerClass,
    shadows,
    shadowPick,
    setShadowPick,
    shadowFrom,
    setShadowFrom,
    shadowBusy,
    shadowError,
    handleAssignShadow,
    handleEndShadow,
  };
}
