// What a write says when the signed-in admin has no business to write into —
// signed out mid-session, or a profile with no tenant_id (no CHECK ties
// tenant_admin to a tenant). Shown INSTEAD of sending the write: the old code
// sent a NULL tenant, the database refused it, and the page said a generic
// "Could not …" that pointed nowhere (Wave 8, the NOT-A-GUARD sites).
export const NO_TENANT_MESSAGE =
  "Your account isn't linked to a business, so nothing was saved. Sign out and back in, then try again.";
