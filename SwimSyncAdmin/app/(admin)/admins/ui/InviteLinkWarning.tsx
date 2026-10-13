// Admins page — shown when an invite/reset email could not be sent: the account
// exists, so the one-time link is surfaced to be passed on by hand.

export function InviteLinkWarning({
  link,
  onDismiss,
}: {
  link: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-4 rounded-card bg-status-warning-bg border border-status-warning-border p-4 text-body text-status-warning-text">
      <p className="font-semibold mb-1">The invite email could not be sent.</p>
      <p className="mb-2">
        The account exists — pass this one-time link to them yourself:
      </p>
      <code className="block break-all text-label bg-surface rounded-control p-2 border border-status-warning-border">
        {link}
      </code>
      <button
        className="mt-2 text-label font-medium text-status-warning-text hover:underline"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
