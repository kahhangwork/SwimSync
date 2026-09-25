import "../global.css";
import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { landingFor, isInsideLanding } from "@/lib/landing";
import { allowsNoSession, isPublicPage } from "@/lib/publicRoutes";
import { useAppStore } from "@/store/useAppStore";
import Toast from "@/components/Toast";

// Pull the tokens out of a Supabase deep link
// (swimsync://reset-password#access_token=…&refresh_token=…&type=recovery, or
// swimsync://accept-invite#…&type=invite).
//
// BOTH kinds land here and both carry a real session, but they go to DIFFERENT
// screens: a recovery is someone who forgot a password, an invite is a parent
// whose coach created their account and who has never had one. Routing an
// invite to /reset-password would offer them "request a new reset link" and,
// on failure, a /forgot-password dead end.
function parseAuthTokens(
  url: string | null
): { access_token: string; refresh_token: string; type: "recovery" | "invite" } | null {
  if (!url) return null;
  const fragment = url.split("#")[1];
  if (!fragment) return null;

  const params: Record<string, string> = {};
  for (const pair of fragment.split("&")) {
    const [k, v] = pair.split("=");
    if (k) params[k] = decodeURIComponent(v ?? "");
  }

  if (
    (params.type === "recovery" || params.type === "invite") &&
    params.access_token &&
    params.refresh_token
  ) {
    return {
      access_token: params.access_token,
      refresh_token: params.refresh_token,
      type: params.type,
    };
  }
  return null;
}

// The auth gate's session-less allowances live in lib/publicRoutes.ts, pinned
// by its test. ⚠ Widening them widens the auth gate.
function currentPath(): string | null {
  return Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.pathname
    : null;
}
// A session-less load may stay here (a public page, or /register etc.).
function allowedWithoutSession(): boolean {
  const path = currentPath();
  return path !== null && allowsNoSession(path);
}
// A signed-in user opening this page stays on it.
function onPublicRoute(): boolean {
  const path = currentPath();
  return path !== null && isPublicPage(path);
}
// Send a recovery/invite session to its screen — unless it is ALREADY showing.
// A replace to the same route mounts a fresh instance and wipes its useState,
// and routeForSession's replace lands only after a profiles read: on a slow
// phone (or CI) that is after the parent has typed the new password (§7.274).
function showAuthScreen(href: "/(auth)/reset-password" | "/(auth)/accept-invite") {
  const path = currentPath();
  if (path !== null && path.replace(/\/+$/, "") === href.replace("/(auth)", "")) return;
  router.replace(href);
}

export default function RootLayout() {
  const setSession = useAppStore((s) => s.setSession);
  const clearSession = useAppStore((s) => s.clearSession);

  useEffect(() => {
    // Shared flag: once we know this launch is a password-recovery or invite
    // flow, the session-restore below must land on the matching screen rather
    // than the home tab.
    const recovery = { current: false };
    const invite = { current: false };

    // On web, supabase-js parses the token from the URL hash during init.
    // Detect it synchronously so getSession() doesn't bounce to home before
    // the PASSWORD_RECOVERY event fires.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const url = window.location.hash + window.location.search;
      if (url.includes("type=recovery")) {
        recovery.current = true;
      } else if (url.includes("type=invite")) {
        invite.current = true;
      }
    }

    async function routeForSession(session: Awaited<
      ReturnType<typeof supabase.auth.getSession>
    >["data"]["session"]) {
      if (!session) {
        clearSession();
        if (!allowedWithoutSession()) router.replace("/(auth)/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", session.user.id)
        .single();

      if (!profile) {
        clearSession();
        router.replace("/(auth)/login");
        return;
      }

      setSession({
        id: session.user.id,
        email: session.user.email!,
        role: profile.role,
        fullName: profile.full_name,
      });

      // A recovery session must go to the reset screen regardless of role.
      if (recovery.current) {
        showAuthScreen("/(auth)/reset-password");
        return;
      }

      // An invited parent has a session but no password of their own yet.
      // Landing them on the home tab would leave an account nobody can sign
      // back into once this one-time session expires.
      if (invite.current) {
        showAuthScreen("/(auth)/accept-invite");
        return;
      }

      // Same rule as login: a private coach holds tenant_admin AND a coaches
      // row, so route on the row, not the enum.
      const { data: coachRow } = await supabase
        .from("coaches")
        .select("id")
        .eq("profile_id", session.user.id)
        .maybeSingle();

      // A signed-in user opening a public page (e.g. their own invoice link
      // from WhatsApp) stays on it — the session is restored above, but the
      // redirect-to-home must not steal the page they asked for.
      if (onPublicRoute()) return;

      // Already on one of this user's own screens (a refresh, a bookmark, a
      // shared link)? Stay there — replacing it with the landing tab lost the
      // coach's place and left the screen they asked for mounted hidden
      // beneath Schedule (§7.254). /login, the bare / and the other role's
      // screens still redirect. Web only: native keeps the old always-replace
      // (its deep links are the auth ones handled above).
      const landing = landingFor(profile.role, !!coachRow);
      if (!landing.route) return;
      const onOwnScreen =
        Platform.OS === "web" &&
        typeof window !== "undefined" &&
        isInsideLanding(window.location.pathname, landing.route);
      if (!onOwnScreen) router.replace(landing.route);
    }

    // Restore session on app launch
    supabase.auth.getSession().then(({ data: { session } }) => {
      routeForSession(session);
    });

    // Listen for auth state changes (login, logout, token expiry, recovery)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          recovery.current = true;
          showAuthScreen("/(auth)/reset-password");
          return;
        }
        if (event === "SIGNED_OUT" || !session) {
          clearSession();
          if (!allowedWithoutSession()) router.replace("/(auth)/login");
        }
      }
    );

    // Native: handle the recovery deep link ourselves (the client has
    // detectSessionInUrl off on native). setSession fires SIGNED_IN, not
    // PASSWORD_RECOVERY, so route to the reset screen explicitly.
    async function handleDeepLink(url: string | null) {
      const tokens = parseAuthTokens(url);
      if (!tokens) return;
      const isInvite = tokens.type === "invite";
      if (isInvite) invite.current = true;
      else recovery.current = true;
      const { error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      if (!error) {
        router.replace(
          isInvite ? "/(auth)/accept-invite" : "/(auth)/reset-password"
        );
      }
    }

    let linkingSub: { remove: () => void } | undefined;
    if (Platform.OS !== "web") {
      Linking.getInitialURL().then(handleDeepLink);
      linkingSub = Linking.addEventListener("url", ({ url }) =>
        handleDeepLink(url)
      );
    }

    return () => {
      subscription.unsubscribe();
      linkingSub?.remove();
    };
  }, []);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="invoice/[token]" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(parent)" />
        <Stack.Screen name="(coach)" />
      </Stack>
      <Toast />
    </>
  );
}
