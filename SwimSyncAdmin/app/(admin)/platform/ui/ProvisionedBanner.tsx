// The green "<business> is set up" panel, shown once after provisioning.
// Stage 6 of docs/refactor/PLATFORM_REFACTOR_PLAN.md, markup verbatim from
// page.tsx lines 493-534.
//
// ⚠ DRIVER CONTRACT — verify-tenant-provisioning finds this panel by the xpath
// `//h3[contains(., "is set up")]/..`, i.e. the <h3>'s PARENT. So the <h3> must
// stay a DIRECT CHILD of the panel <div>, with the join code and the delivery
// sentence as its siblings. Do NOT wrap the <h3> in a flex row or a <header>:
// the panel would still look right and the driver would read the wrong element.
//
// ⚠ The join code is the ONLY route into a business — there is no directory —
// so it is shown once, prominently, at the moment it is created.
//
// ⚠ The amber branch is not a styling variant. A missing invite email means the
// new owner has no way in at all, so `emailSent === false` must never render as
// a plain success.

type Provisioned = {
  businessName: string;
  joinCode: string;
  adminEmail: string;
  emailSent: boolean;
  inviteLink: string | null;
};

export function ProvisionedBanner({
  provisioned,
  onDismiss,
}: {
  provisioned: Provisioned;
  onDismiss: () => void;
}) {
  return (
              <div className="mb-6 rounded-card border border-status-success-border bg-status-success-bg p-4">
          <h3 className="text-body font-semibold text-status-success-text">
            {provisioned.businessName} is set up
          </h3>
          <p className="mt-1 text-body text-status-success-text">
            Join code:{" "}
            <span className="font-mono font-semibold">
              {provisioned.joinCode}
            </span>{" "}
            — parents enter this in the app to join.
          </p>
          {provisioned.emailSent ? (
            <p className="mt-1 text-body text-status-success-text">
              An invite to set a password was sent to{" "}
              <strong>{provisioned.adminEmail}</strong>.
            </p>
          ) : (
            /* The email IS the deliverable here — unlike an invoice email, a
               missing invite means the owner has no way in at all. So this must
               never read as a plain success. */
            <div className="mt-2 rounded-card border border-status-warning-border bg-status-warning-bg p-3">
              <p className="text-body font-semibold text-status-warning-text">
                No invite email was sent.
              </p>
              <p className="mt-1 text-body text-status-warning-text">
                Send this one-time link to <strong>{provisioned.adminEmail}</strong>{" "}
                yourself — they cannot sign in until they use it:
              </p>
              <code className="mt-2 block break-all rounded bg-surface p-2 text-label text-ink">
                {provisioned.inviteLink}
              </code>
            </div>
          )}
          <button
            onClick={onDismiss}
            className="mt-3 text-label font-medium text-status-success-text hover:text-status-success-text"
          >
            Dismiss
          </button>
        </div>
  );
}
