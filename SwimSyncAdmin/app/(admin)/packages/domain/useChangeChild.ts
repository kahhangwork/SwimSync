// Change child (single-child packages, D4). The admin moves a one-child package
// to a sibling while it is unused. reassign_package_child() is the authority on
// "unused" — a reversed draw restores the balance, so nothing here can tell —
// and its refusals are sentences for the admin, shown inline in the dialog
// (⚠ RISK 10: never a silent failure, never Alert/console only).

import { useState } from "react";
import * as rpc from "../dao/packages.rpc";
import type { ChildOption, Purchase } from "../types";

type Shared = {
  setBusy: (b: boolean) => void;
  reload: () => void;
  childOptions: Map<string, ChildOption[]>;
};

export function useChangeChild({ setBusy, reload, childOptions }: Shared) {
  const [target, setTarget] = useState<Purchase | null>(null);
  const [childId, setChildId] = useState("");
  const [changeError, setChangeError] = useState<string | null>(null);

  // The family's other active children at this business.
  const options: ChildOption[] = target
    ? (childOptions.get(target.parent_id) ?? []).filter((c) => c.id !== target.student_id)
    : [];

  function openChangeChild(p: Purchase) {
    setTarget(p);
    const others = (childOptions.get(p.parent_id) ?? []).filter((c) => c.id !== p.student_id);
    setChildId(others.length === 1 ? others[0].id : "");
    setChangeError(null);
  }

  function closeChangeChild() {
    setTarget(null);
    setChangeError(null);
  }

  async function saveChangeChild() {
    if (!target || !childId) return;
    setBusy(true);
    setChangeError(null);
    const { error } = await rpc.reassignPackageChild({ p_package: target.id, p_student: childId });
    setBusy(false);
    if (error) {
      setChangeError(error.message || "Could not change the child.");
      return;
    }
    setTarget(null);
    reload();
  }

  return {
    target,
    options,
    childId,
    setChildId,
    changeError,
    openChangeChild,
    closeChangeChild,
    saveChangeChild,
  };
}

export type ChangeChildForm = ReturnType<typeof useChangeChild>;
