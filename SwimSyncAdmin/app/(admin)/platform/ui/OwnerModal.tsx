// The Change-owner modal. Stage 7 of docs/refactor/PLATFORM_REFACTOR_PLAN.md,
// markup verbatim from page.tsx lines 464-531.
//
// ⚠ NO DRIVER OPENS THIS. See domain/useOwnerTransfer.ts for why, and for the
// stale-response guard that decides WHICH business's admins this list belongs to.
//
// ⚠ `disabled={a.is_owner || a.is_disabled}` on the <option> is not decoration:
// the RPC refuses a deactivated target and the current owner too, so the
// disabled option saves a round trip to a refusal the operator cannot act on.
// Do NOT drop it.
//
// ⚠ The empty-list branch ("No admin accounts to choose from") is the LOST-OWNER
// case's honest answer: a business whose Admin cell reads "no admin" may still
// hold live co-admins to promote, and when it does not, this text is what says so.

import { Modal } from "@/components/Modal";
import type { TenantAdminOption } from "../types";

export function OwnerModal({
  ownerModal,
  ownerAdmins,
  ownerLoading,
  ownerChoice,
  ownerSaving,
  ownerError,
  onChoose,
  onConfirm,
  onClose,
}: {
  ownerModal: { tenantId: string; tenantName: string; currentEmail: string | null } | null;
  ownerAdmins: TenantAdminOption[];
  ownerLoading: boolean;
  ownerChoice: string;
  ownerSaving: boolean;
  ownerError: string | null;
  onChoose: (id: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
        <Modal
          title={`Change owner — ${ownerModal?.tenantName ?? ""}`}
          open={ownerModal !== null}
          onClose={onClose}
        >
          <p className="mb-3 text-sm text-gray-700">
            The owner is the one account that can manage this business&apos;s
            admins. Ownership moves immediately;{" "}
            {ownerModal?.currentEmail ? (
              <>
                <span className="font-medium">{ownerModal.currentEmail}</span>{" "}
                stays on as a co-admin.
              </>
            ) : (
              <>this business currently has no owner at all.</>
            )}
          </p>
          {ownerLoading ? (
            <p className="mb-4 text-sm text-gray-400">Loading admins…</p>
          ) : ownerAdmins.length === 0 && !ownerError ? (
            <p className="text-sm text-gray-500">
              No admin accounts to choose from — this business has no
              co-admins. Invite one first.
            </p>
          ) : (
            <select
              value={ownerChoice}
              onChange={(e) => onChoose(e.target.value)}
              className="mb-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Choose the new owner…</option>
              {ownerAdmins.map((a) => (
                <option
                  key={a.profile_id}
                  value={a.profile_id}
                  disabled={a.is_owner || a.is_disabled}
                >
                  {a.full_name || a.email}
                  {a.is_owner ? " — current owner" : ""}
                  {a.is_disabled ? " — deactivated" : ""}
                </option>
              ))}
            </select>
          )}
          {ownerError && (
            <p className="mb-3 text-sm font-medium text-red-600">{ownerError}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={onConfirm}
              disabled={!ownerChoice || ownerSaving}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
            >
              {ownerSaving
                ? "Transferring…"
                : `Make ${
                    ownerAdmins.find((a) => a.profile_id === ownerChoice)
                      ?.full_name || "them"
                  } the owner`}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700"
            >
              Cancel
            </button>
          </div>
        </Modal>
  );
}
