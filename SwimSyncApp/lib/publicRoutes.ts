// Which web paths the root layout's auth gate lets through WITHOUT a session.
// Everything else, loaded session-less, is replaced with /login.
//
// ⚠ Widening either list widens the auth gate — weigh every addition. Pure so
// the lists are pinned by publicRoutes.test.ts.

// Pages that render with OR without a session, and that a signed-in user also
// STAYS on (e.g. their own invoice link opened from WhatsApp). There are
// exactly TWO tokenized public PAYMENT pages, and both earn their place because
// the caller is a sessionless parent who clicked a WhatsApp/email link and the
// 128-bit token in the URL is the whole access control:
//   • /invoice — the public invoice page (a month's bill).
//   • /package — the public package-OFFER page (a renewal to pre-pay).
// The AUTHED equivalents live under /billing/…, which startsWith does not match.
// /welcome is the parent-facing onboarding page.
const PUBLIC_PAGES = ["/welcome", "/invoice", "/package"];

// Signed-OUT screens a link may open directly: `swimsync.sg/register` is the
// link a coach sends a new family (2026-09-25 — it used to land on Sign In).
// Unlike PUBLIC_PAGES, a signed-in user is still sent to their landing, exactly
// as /login does. Matched EXACTLY, not by prefix.
// /reset-password and /accept-invite are deliberately NOT here: they need the
// token session, and the layout routes to them on the URL's #type flag.
const SIGNED_OUT_SCREENS = ["/register", "/forgot-password"];

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** A page that renders with or without a session, and keeps a signed-in user. */
export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some((p) => pathname.startsWith(p));
}

/** Whether a session-less load of `pathname` may stay where it is. */
export function allowsNoSession(pathname: string): boolean {
  return isPublicPage(pathname) || SIGNED_OUT_SCREENS.includes(trimSlash(pathname));
}
