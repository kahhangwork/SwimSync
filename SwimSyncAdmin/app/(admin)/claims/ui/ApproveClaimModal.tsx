// Parent Requests — two-step confirm, naming BOTH parties, with the name picker.

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { Claim } from "../types";

type Props = {
  confirming: Claim | null;
  onClose: () => void;
  nameChoice: string;
  setNameChoice: (v: string) => void;
  busy: string | null;
  onApprove: (c: Claim) => void;
};

export function ApproveClaimModal(p: Props) {
  const { confirming } = p;
  return (
    <Modal
      open={confirming !== null}
      onClose={p.onClose}
      title="Link this child to this parent?"
    >
      {confirming && (
        <div className="space-y-4">
          <p className="text-body text-ink-secondary">
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
          <p className="text-body text-ink-muted">
            They will be able to see this child&apos;s attendance and billing
            history, and future lessons will be invoiced to them. You can undo
            this from the decided list, until the child has been invoiced.
          </p>

          {/* ⚠ RISK 1: the name picker. Default is parent-name for a
              confirmed claim, current name for an unsure one (see the nameChoice
              useEffect in useClaims). Applied via rename_student() after the link. */}
          <div className="rounded-card border border-border bg-ground p-3">
            <p className="text-label font-semibold text-ink-secondary">
              Name on your roster after linking
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => p.setNameChoice(confirming.student_name)}
                className="rounded-control border border-border-strong bg-surface px-2.5 py-1 text-label font-medium text-ink hover:bg-ground"
              >
                Keep &ldquo;{confirming.student_name}&rdquo;
              </button>
              {confirming.claimed_name.trim() !== "" &&
                confirming.claimed_name !== confirming.student_name && (
                  <button
                    type="button"
                    onClick={() => p.setNameChoice(confirming.claimed_name)}
                    className="rounded-control border border-border-strong bg-surface px-2.5 py-1 text-label font-medium text-ink hover:bg-ground"
                  >
                    Use &ldquo;{confirming.claimed_name}&rdquo; (parent&apos;s)
                  </button>
                )}
            </div>
            <input
              value={p.nameChoice}
              onChange={(e) => p.setNameChoice(e.target.value)}
              className="mt-2 w-full rounded-control border border-border-strong px-3 py-2 text-body"
            />
            {confirming.certainty === "unsure" && (
              <p className="mt-1 text-label text-status-warning-text">
                This parent said they weren&apos;t sure, so the current name is
                kept unless you change it.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => p.onApprove(confirming)}
              disabled={p.busy === confirming.id}
            >
              {p.busy === confirming.id ? "Linking…" : "Yes, link them"}
            </Button>
            <Button variant="outline" onClick={p.onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
