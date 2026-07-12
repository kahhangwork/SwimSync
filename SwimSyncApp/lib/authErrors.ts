import type { AuthError } from "@supabase/supabase-js";

/**
 * Maps raw Supabase auth error messages to friendly, user-facing copy.
 * Falls back to the original message for anything we don't recognise.
 */
export function friendlyAuthError(
  error: AuthError | { message?: string } | null | undefined,
  fallback = "Something went wrong. Please try again."
): string {
  const raw = error?.message?.trim();
  if (!raw) return fallback;

  const msg = raw.toLowerCase();

  if (msg.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (msg.includes("already registered") || msg.includes("already been registered")) {
    return "An account with this email already exists.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please confirm your email first — check your inbox for the link.";
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (msg.includes("password should be") || msg.includes("password is too")) {
    return "Password is too weak. Use at least 8 characters.";
  }
  if (msg.includes("unable to validate email") || msg.includes("invalid email")) {
    return "Please enter a valid email address.";
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return "Network error. Check your connection and try again.";
  }

  return raw;
}
