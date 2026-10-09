// Backdated activation (Wave 6 D5). After a package becomes active — Confirm
// payment or Record a sale, the two activation paths in the census — lessons
// the family ALREADY had marked since its start date are not drawn by the
// marking trigger. This asks the admin, only when such lessons exist:
//   Draw from package → draw_package_backlog (re-derives; returns the count)
//   Keep as ad-hoc    → nothing; they bill at the next run.
//
// ⚠ ORDER: offer() runs AFTER the activation write succeeded. The preview reads
// the package as active; called before, it sees nothing and the dialog never
// opens. Invoiced lessons stay invoiced — the preview never lists them.
//
// check() is the SAME question asked again on demand — the Held table's "Check
// marked lessons" (PRD §7.16). offer() is asked once;
// if its preview failed or the tab closed, nothing else could ever draw those
// lessons and they billed ad-hoc. Both RPCs re-derive at call time, so asking
// again is safe: drawn lessons are no longer candidates and are never listed.
// Unlike offer(), an empty answer is SAID (the admin asked a question).

import { useState } from "react";
import * as rpc from "../dao/packages.rpc";
import type { BacklogRow } from "./backlogDraw";

export type Backlog = {
  packageId: string;
  packageName: string;
  rows: BacklogRow[];
  /** The draw's returned count, once pressed. */
  drawn: number | null;
  /** The DB's refusal, verbatim (switch off, not authorised, not active). */
  error: string | null;
  /** "activation" = asked by offer() right after activating; "check" = the
   *  admin asked from the Held table (may have no rows). */
  source: "activation" | "check";
};

type Shared = {
  setError: (e: string | null) => void;
  reload: () => void;
};

export function useBacklogDraw({ setError, reload }: Shared) {
  const [backlog, setBacklog] = useState<Backlog | null>(null);
  const [drawing, setDrawing] = useState(false);
  /** The package id a check() is reading, else null. */
  const [checking, setChecking] = useState<string | null>(null);

  async function offer(packageId: string, packageName: string) {
    const { data, error } = await rpc.packageBacklogPreview(packageId);
    if (error) {
      // The package IS active; only the check failed. Said, not swallowed: an
      // unasked question here silently leaves those lessons to bill ad-hoc.
      setError(
        `${packageName} is active, but checking for lessons already marked since its start date failed (${error.message}). Any such lessons will bill as ad-hoc.`
      );
      return;
    }
    const rows = (data ?? []) as BacklogRow[];
    if (!rows.length) return; // D5: asked only when such lessons exist.
    setBacklog({ packageId, packageName, rows, drawn: null, error: null, source: "activation" });
  }

  async function check(packageId: string, packageName: string) {
    if (checking) return;
    setChecking(packageId);
    setError(null);
    const { data, error } = await rpc.packageBacklogPreview(packageId);
    setChecking(null);
    if (error) {
      setError(
        `Checking ${packageName} for lessons already marked failed (${error.message}). Nothing was drawn.`
      );
      return;
    }
    const rows = (data ?? []) as BacklogRow[];
    setBacklog({ packageId, packageName, rows, drawn: null, error: null, source: "check" });
  }

  async function draw() {
    if (!backlog || drawing || backlog.drawn !== null) return;
    setDrawing(true);
    const { data, error } = await rpc.drawPackageBacklog(backlog.packageId);
    setDrawing(false);
    if (error) {
      setBacklog({ ...backlog, error: error.message });
      return;
    }
    setBacklog({ ...backlog, drawn: Number(data ?? 0), error: null });
    reload();
  }

  /** Keep as ad-hoc, or Close after a draw. Writes nothing. */
  function dismiss() {
    setBacklog(null);
  }

  return { backlog, drawing, checking, offer, check, draw, dismiss };
}

export type BacklogDraw = ReturnType<typeof useBacklogDraw>;
