// Creating a business, and re-sending its admin's invite. Stage 6 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md.
//
// ⚠ THIS MINTS AN INVITE THAT GRANTS tenant_admin OF A NEW BUSINESS. Whoever
// opens the link becomes the admin, so a mistyped address is a cross-tenant data
// exposure, not a bounced email — which is why the address is typed twice and
// compared before anything is created. The comparison trims and lower-cases
// BOTH sides; weakening either half re-opens the exposure.
//
// ⚠ THE EMAIL IS THE DELIVERABLE. Unlike an invoice email, a missing invite
// means the new owner has no way in at all. So a send failure must never read as
// a plain success: `provisioned.emailSent === false` drives an amber panel
// carrying the one-time link for the operator to pass on by hand.

import { useState } from "react";
import { postAs } from "../dao/platform.api";

const BLANK = {
  businessName: "",
  adminName: "",
  adminEmail: "",
  // Typed twice on purpose: this invite grants tenant_admin to whoever opens
  // it, so a mistyped address is a cross-tenant data exposure, not a bounced
  // email.
  adminEmailConfirm: "",
  isCoach: true,
};

export function useProvisioning(
  load: () => Promise<void>,
  setMessage: (m: string | null) => void
) {
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [resending, setResending] = useState<string | null>(null);
  const [newBiz, setNewBiz] = useState(BLANK);
  const [newBizError, setNewBizError] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<{
    businessName: string;
    joinCode: string;
    adminEmail: string;
    emailSent: boolean;
    inviteLink: string | null;
  } | null>(null);

  async function provisionTenant(e: React.FormEvent) {
    e.preventDefault();
    setNewBizError(null);

    if (!newBiz.businessName.trim()) {
      setNewBizError("The business needs a name.");
      return;
    }
    if (!newBiz.adminName.trim()) {
      setNewBizError("The admin needs a name.");
      return;
    }
    if (
      newBiz.adminEmail.trim().toLowerCase() !==
      newBiz.adminEmailConfirm.trim().toLowerCase()
    ) {
      setNewBizError(
        "The two email addresses don't match. This invite grants full admin of the business, so it must go to the right person."
      );
      return;
    }

    setCreating(true);
    const { res, json } = await postAs("/api/provision-tenant", {
      businessName: newBiz.businessName.trim(),
      // No `kind`: the column is gone (20260804000100). A business's shape is
      // derived from its data, never declared (PRD §4.4).
      adminName: newBiz.adminName.trim(),
      adminEmail: newBiz.adminEmail.trim(),
      isCoach: newBiz.isCoach,
    });
    setCreating(false);

    if (!res.ok) {
      setNewBizError(json.error ?? "Could not create the business.");
      return;
    }

    setProvisioned({
      businessName: newBiz.businessName.trim(),
      joinCode: json.joinCode,
      adminEmail: json.adminEmail,
      emailSent: Boolean(json.emailSent),
      inviteLink: json.inviteLink ?? null,
    });
    setShowNew(false);
    setNewBiz(BLANK);
    await load();
  }

  async function resendInvite(tenantId: string) {
    setResending(tenantId);
    setMessage(null);
    const { res, json } = await postAs("/api/resend-invite", { tenantId });
    setResending(null);
    if (!res.ok) {
      setMessage(json.error ?? "Could not resend the invite.");
      return;
    }
    setMessage(
      json.emailSent
        ? `Invite resent to ${json.adminEmail}.`
        : `No email was sent (${json.emailReason}). Copy this link to them: ${json.inviteLink}`
    );
  }

  return {
    showNew,
    setShowNew,
    creating,
    resending,
    newBiz,
    setNewBiz,
    newBizError,
    setNewBizError,
    provisioned,
    setProvisioned,
    provisionTenant,
    resendInvite,
  };
}
