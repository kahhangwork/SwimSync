import { useState } from "react";
import * as rpc from "../dao/classes.rpc";
import type { ClassRow } from "../types";

/**
 * Retire / restore. Takes the list's `load` so a state change is proven by a
 * round-trip reload, not patched in place. `retireFor` + `retireError` are also
 * read by the toolbar's top-level banner (RISK 9 — the `retireError && retireFor
 * === null` guard lives in ui/ClassToolbar).
 */
export function useRetire(load: () => Promise<void>) {
  const [retireFor, setRetireFor] = useState<ClassRow | null>(null);
  const [retireSaving, setRetireSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);

  // Both refusal messages come from deactivate_class() itself and are RENDERED,
  // never swallowed: each one names the children, the booked guests or the
  // unmarked dates standing in the way, which is the whole difference between
  // an instruction and a dead end. Pre-empting them here would be a second copy
  // of three rules that already live in one place.
  async function handleRetire() {
    if (!retireFor) return;
    setRetireSaving(true);
    setRetireError(null);

    const { error } = await rpc.deactivateClass({
      p_class_id: retireFor.id,
    });

    setRetireSaving(false);
    if (error) {
      setRetireError(error.message);
      return;
    }
    setRetireFor(null);
    // Reload rather than patch in place: the row does not disappear, it changes
    // state, and the reload is what proves the round trip works from this page
    // alone.
    await load();
  }

  // No confirm, no refusal, no error surface it can get stuck behind. This is
  // the emergency exit from a class that is blocking a billing month while
  // being invisible everywhere else — anything that can stop it can strand a
  // business.
  async function handleRestore(cls: ClassRow) {
    // Guarded rather than disabled-on-a-shared-flag: two different rows must
    // never block each other, and reactivate_class() is idempotent anyway — the
    // in-flight id exists so the row can SAY something is happening.
    if (restoringId) return;
    setRestoringId(cls.id);
    setRetireError(null);

    const { error } = await rpc.reactivateClass({
      p_class_id: cls.id,
    });

    setRestoringId(null);
    if (error) {
      // Named, because the banner sits at the top of a table that can be long
      // enough to scroll the message out of view.
      setRetireError(`Could not restore ${cls.title}: ${error.message}`);
      return;
    }
    await load();
  }

  return {
    retireFor,
    setRetireFor,
    retireSaving,
    restoringId,
    retireError,
    setRetireError,
    handleRetire,
    handleRestore,
  };
}
