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

          {/* ⚠ RISK 1: the name picker. Default is parent-name for a
              confirmed claim, current name for an unsure one (see the nameChoice
              useEffect in useClaims). Applied via rename_student() after the link. */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-600">
              Name on your roster after linking
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => p.setNameChoice(confirming.student_name)}
                className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
              >
                Keep &ldquo;{confirming.student_name}&rdquo;
              </button>
              {confirming.claimed_name.trim() !== "" &&
                confirming.claimed_name !== confirming.student_name && (
                  <button
                    type="button"
                    onClick={() => p.setNameChoice(confirming.claimed_name)}
                    className="rounded-full border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
                  >
                    Use &ldquo;{confirming.claimed_name}&rdquo; (parent&apos;s)
                  </button>
                )}
            </div>
            <input
              value={p.nameChoice}
              onChange={(e) => p.setNameChoice(e.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {confirming.certainty === "unsure" && (
              <p className="mt-1 text-[11px] text-amber-700">
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
