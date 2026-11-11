// Which account the recovery link is for — read from the recovery session the
// link itself carries, so the page can say so (BACKLOG *UI restyle leftovers*:
// "does not say which account it is for"). Display only: null → generic copy.
export function accountEmailOf(session: unknown): string | null {
  const email = (session as { user?: { email?: unknown } } | null)?.user?.email;
  return typeof email === "string" && email.trim() !== "" ? email : null;
}
