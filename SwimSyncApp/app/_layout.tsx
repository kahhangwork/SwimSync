import "../global.css";
import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/store/useAppStore";

// Pull the recovery tokens out of a Supabase deep link
// (swimsync://reset-password#access_token=…&refresh_token=…&type=recovery).
// Returns null unless this is a recovery link with both tokens present.
function parseRecoveryTokens(
  url: string | null
): { access_token: string; refresh_token: string } | null {
  if (!url) return null;
  const fragment = url.split("#")[1];
  if (!fragment) return null;

  const params: Record<string, string> = {};
  for (const pair of fragment.split("&")) {
    const [k, v] = pair.split("=");
    if (k) params[k] = decodeURIComponent(v ?? "");
  }

  if (params.type === "recovery" && params.access_token && params.refresh_token) {
    return {
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    };
  }
  return null;
}

export default function RootLayout() {
  const setSession = useAppStore((s) => s.setSession);
  const clearSession = useAppStore((s) => s.clearSession);

  useEffect(() => {
    // Shared flag: once we know this launch is a password-recovery flow, the
    // session-restore below must land on the reset screen, not the home tab.
    const recovery = { current: false };

    // On web, supabase-js parses the recovery token from the URL hash during
    // init. Detect it synchronously so getSession() doesn't bounce to home
    // before the PASSWORD_RECOVERY event fires.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const url = window.location.hash + window.location.search;
      if (url.includes("type=recovery")) {
        recovery.current = true;
      }
    }

    async function routeForSession(session: Awaited<
      ReturnType<typeof supabase.auth.getSession>
    >["data"]["session"]) {
      if (!session) {
        clearSession();
        router.replace("/(auth)/login");
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
        router.replace("/(auth)/reset-password");
        return;
      }

      if (profile.role === "parent") {
        router.replace("/(parent)/home");
      } else if (profile.role === "coach") {
        router.replace("/(coach)/today");
      }
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
          router.replace("/(auth)/reset-password");
          return;
        }
        if (event === "SIGNED_OUT" || !session) {
          clearSession();
          router.replace("/(auth)/login");
        }
      }
    );

    // Native: handle the recovery deep link ourselves (the client has
    // detectSessionInUrl off on native). setSession fires SIGNED_IN, not
    // PASSWORD_RECOVERY, so route to the reset screen explicitly.
    async function handleDeepLink(url: string | null) {
      const tokens = parseRecoveryTokens(url);
      if (!tokens) return;
      recovery.current = true;
      const { error } = await supabase.auth.setSession(tokens);
      if (!error) {
        router.replace("/(auth)/reset-password");
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
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(parent)" />
        <Stack.Screen name="(coach)" />
      </Stack>
    </>
  );
}
