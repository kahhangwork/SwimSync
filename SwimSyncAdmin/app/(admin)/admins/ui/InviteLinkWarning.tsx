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
    <div className="mb-4 rounded-xl bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-800">
      <p className="font-semibold mb-1">The invite email could not be sent.</p>
      <p className="mb-2">
        The account exists — pass this one-time link to them yourself:
      </p>
      <code className="block break-all text-xs bg-white rounded-lg p-2 border border-yellow-200">
        {link}
      </code>
      <button
        className="mt-2 text-xs font-medium text-yellow-700 hover:underline"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
