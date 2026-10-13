import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import type { Membership } from "../types";

export function GrantModal({
  open,
  onClose,
  memberships,
  grantParent,
  setGrantParent,
  grantReason,
  setGrantReason,
  busy,
  onGrant,
}: {
  open: boolean;
  onClose: () => void;
  memberships: Membership[];
  grantParent: string;
  setGrantParent: (v: string) => void;
  grantReason: string;
  setGrantReason: (v: string) => void;
  busy: boolean;
  onGrant: () => void;
}) {
  return (
    <Modal title="Grant a referral reward" open={open} onClose={onClose}>
      <p className="text-body text-ink-secondary mb-3">
        A goodwill discount for a family — e.g. a friend who forgot to enter the
        code. It joins the queue like any earned reward.
      </p>
      <div className="mb-3">
        <div className="text-label font-semibold text-ink-muted mb-1">Family</div>
        <select
          value={grantParent}
          onChange={(e) => setGrantParent(e.target.value)}
          className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
        >
          <option value="">Choose a family…</option>
          {memberships.map((m) => (
            <option key={m.parent_id} value={m.parent_id}>{m.name}</option>
          ))}
        </select>
      </div>
      <div className="mb-4">
        <div className="text-label font-semibold text-ink-muted mb-1">Reason</div>
        <input
          value={grantReason}
          onChange={(e) => setGrantReason(e.target.value)}
          placeholder="Goodwill"
          className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={onGrant} disabled={busy || !grantParent}>Grant</Button>
      </div>
    </Modal>
  );
}
