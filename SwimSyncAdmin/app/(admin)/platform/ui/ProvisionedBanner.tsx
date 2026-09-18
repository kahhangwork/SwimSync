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
              <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4">
          <h3 className="text-sm font-semibold text-green-900">
            {provisioned.businessName} is set up
          </h3>
          <p className="mt-1 text-sm text-green-800">
            Join code:{" "}
            <span className="font-mono font-semibold">
              {provisioned.joinCode}
            </span>{" "}
            — parents enter this in the app to join.
          </p>
          {provisioned.emailSent ? (
            <p className="mt-1 text-sm text-green-800">
              An invite to set a password was sent to{" "}
              <strong>{provisioned.adminEmail}</strong>.
            </p>
          ) : (
            /* The email IS the deliverable here — unlike an invoice email, a
               missing invite means the owner has no way in at all. So this must
               never read as a plain success. */
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                No invite email was sent.
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Send this one-time link to <strong>{provisioned.adminEmail}</strong>{" "}
                yourself — they cannot sign in until they use it:
              </p>
              <code className="mt-2 block break-all rounded bg-white p-2 text-xs text-gray-800">
                {provisioned.inviteLink}
              </code>
            </div>
          )}
          <button
            onClick={onDismiss}
            className="mt-3 text-xs font-medium text-green-800 hover:text-green-900"
          >
            Dismiss
          </button>
        </div>
  );
}
