// The Forgot Password screen's state and send (docs/refactor/BATCH_FGH_PLAN.md, app
// fence). Moved VERBATIM from app/(auth)/forgot-password.tsx; the auth call is a dao
// call, the redirect target domain/resetRedirectTo.
import { useState } from "react";
import { friendlyAuthError } from "@/lib/authErrors";
import { useAppStore } from "@/store/useAppStore";
import { resetPasswordForEmail } from "../dao/forgotPassword.auth";
import { resetRedirectTo } from "./resetRedirectTo";

export function useForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const showToast = useAppStore((s) => s.showToast);

  async function handleSend() {
    if (!email.trim()) {
      showToast("Please enter your email address.", "error");
      return;
    }

    setLoading(true);

    const { error } = await resetPasswordForEmail(email.trim(), {
      redirectTo: resetRedirectTo(),
    });

    setLoading(false);

    if (error) {
      showToast(friendlyAuthError(error), "error");
      return;
    }

    setSent(true);
  }

  return {
    email,
    setEmail,
    loading,
    sent,
    handleSend,
  };
}
