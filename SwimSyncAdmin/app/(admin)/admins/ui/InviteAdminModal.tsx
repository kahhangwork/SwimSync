// Admins page — invite-an-admin modal.

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
  isCoachInvite: boolean;
  setIsCoachInvite: (v: boolean) => void;
  inviting: boolean;
  inviteError: string | null;
  handleInvite: () => void;
};

export function InviteAdminModal(p: Props) {
  return (
    <Modal title="Invite an admin" open={p.open} onClose={p.onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          They&apos;ll get an email with a link to set their password. A
          co-admin can do everything you can — except manage admin accounts.
        </p>
        <Field
          label="Full Name"
          placeholder="Priya Nair"
          value={p.name}
          onChange={p.setName}
        />
        <Field
          label="Email"
          placeholder="admin@example.com"
          type="email"
          value={p.email}
          onChange={p.setEmail}
        />
        <Field
          label="Phone (optional)"
          placeholder="+65 9876 5432"
          value={p.phone}
          onChange={p.setPhone}
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={p.isCoachInvite}
            onChange={(e) => p.setIsCoachInvite(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-400"
          />
          They also teach — create a coach account too
        </label>

        {p.inviteError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {p.inviteError}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={p.onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={p.inviting} onClick={p.handleInvite}>
            {p.inviting ? "Inviting…" : "Send invite"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
