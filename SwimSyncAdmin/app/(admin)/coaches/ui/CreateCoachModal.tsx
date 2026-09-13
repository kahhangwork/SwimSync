// Coaches page — create-coach-account modal.

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Field } from "./Field";

type Props = {
  open: boolean;
  onClose: () => void;
  name: string;
  setName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  creating: boolean;
  createError: string | null;
  handleCreate: () => void;
};

export function CreateCoachModal(p: Props) {
  return (
    <Modal title="Create Coach Account" open={p.open} onClose={p.onClose}>
      <div className="space-y-4">
        <Field label="Full Name" placeholder="Marcus Lim" value={p.name} onChange={p.setName} />
        <Field
          label="Email"
          placeholder="coach@swimsync.sg"
          type="email"
          value={p.email}
          onChange={p.setEmail}
        />
        <Field label="Phone" placeholder="+65 9876 5432" value={p.phone} onChange={p.setPhone} />
        <Field
          label="Temp Password"
          placeholder="••••••••"
          type="password"
          value={p.password}
          onChange={p.setPassword}
        />

        {p.createError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {p.createError}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={p.onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={p.creating} onClick={p.handleCreate}>
            {p.creating ? "Creating…" : "Create Account"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
