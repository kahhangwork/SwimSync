import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { TrialsState } from "../domain/useTrials";

// Convert a trial to an enrolment. The two-press guard lives in
// domain/useTrials (handleConvert) and domain/trialConvert — this only shows it.
export function ConvertTrialModal(p: { t: TrialsState }) {
  return (
    <Modal
      title="Convert to enrolled"
      open={p.t.convertTarget !== null}
      onClose={() => p.t.setConvertTarget(null)}
    >
      {p.t.convertTarget && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Enrol <strong>{p.t.convertTarget.student_name}</strong> into{" "}
            <strong>{p.t.convertTarget.class_title}</strong>?
          </p>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This makes them <strong>expected every week</strong> from now on. An
            unmarked lesson then blocks that class&apos;s billing month — so only
            convert a child who is really joining. The trial lesson above still
            needs marking either way.
          </p>

          {p.t.convertError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {p.t.convertError}
            </p>
          )}

          <Button
            className="w-full"
            disabled={p.t.convertBusy}
            onClick={p.t.handleConvert}
          >
            {p.t.convertBusy
              ? "Converting…"
              : p.t.convertConfirmed
                ? "Convert anyway"
                : "Convert to enrolled"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
