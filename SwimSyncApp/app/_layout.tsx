import "../global.css";
import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/store/useAppStore";

export default function RootLayout() {
  const setSession = useAppStore((s) => s.setSession);
  const clearSession = useAppStore((s) => s.clearSession);

  useEffect(() => {
    // Restore session on app launch
    supabase.auth.getSession().then(async ({ data: { session } }) => {
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

      if (profile.role === "parent") {
        router.replace("/(parent)/home");
      } else if (profile.role === "coach") {
        router.replace("/(coach)/today");
      }
    });

    // Listen for auth state changes (login, logout, token expiry)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_OUT" || !session) {
          clearSession();
          router.replace("/(auth)/login");
        }
      }
    );

    return () => subscription.unsubscribe();
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
