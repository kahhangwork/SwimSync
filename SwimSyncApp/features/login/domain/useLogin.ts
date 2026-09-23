// The Login screen's form state and sign-in (docs/refactor/BATCH_FGH_PLAN.md, app
// fence). Moved VERBATIM from app/(auth)/login.tsx; the three builders are dao calls.
//
// ⚠ plan R1 — THIS SEQUENCE IS ON EVERY APP DRIVER'S PATH, and a break in it is
// HIDDEN by loginExpo's 3-try retry (the stored session is restored by
// _layout.tsx on the next /login load). Byte-identical order: signIn → error
// check → profile + coach reads → setLoading(false) → profile error check →
// setSession → landingFor → router.replace. L4-Fence proves it with a one-shot
// login, no reload.
import { useState } from "react";
import { router } from "expo-router";
import { useAppStore } from "@/store/useAppStore";
import { landingFor } from "@/lib/landing";
import { friendlyAuthError } from "@/lib/authErrors";
import { signInWithPassword } from "../dao/login.auth";
import { fetchLoginProfile, fetchCoachRow } from "../dao/login.repo";

export function useLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const setSession = useAppStore((s) => s.setSession);
  const showToast = useAppStore((s) => s.showToast);

  async function handleLogin() {
    if (!email || !password) {
      showToast("Please enter your email and password.", "error");
      return;
    }

    setLoading(true);

    const { data, error } = await signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error || !data.user) {
      setLoading(false);
      showToast(friendlyAuthError(error), "error");
      return;
    }

    // Profile + whether they actually teach. A PRIVATE COACH is a tenant_admin
    // with a coaches row, so the role alone cannot decide where they land.
    const [{ data: profile, error: profileError }, { data: coachRow }] =
      await Promise.all([
        fetchLoginProfile(data.user.id),
        fetchCoachRow(data.user.id),
      ]);

    setLoading(false);

    if (profileError || !profile) {
      showToast("Could not load your profile. Please try again.", "error");
      return;
    }

    setSession({
      id: data.user.id,
      email: data.user.email!,
      role: profile.role,
      fullName: profile.full_name,
    });

    const landing = landingFor(profile.role, !!coachRow);
    if (landing.route) {
      router.replace(landing.route);
    } else {
      showToast(landing.reason, "error");
    }
  }

  return {
    email,
    setEmail,
    password,
    setPassword,
    loading,
    handleLogin,
  };
}
