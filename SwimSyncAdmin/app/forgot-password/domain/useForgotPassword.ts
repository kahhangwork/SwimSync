import { useState } from "react";
import { sendResetEmail } from "../dao/forgotPassword.repo";

export function useForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setLoading(true);
    // ⚠ `window.location.origin` is read HERE, at call time, never at module
    // scope (BATCH_E_PLAN.md RISK 2): this page prerenders at `next build`.
    // The value itself must not change — Supabase's allow-list is exact-match
    // and a substituted URL still "works" while landing nowhere useful (§7.41).
    const { error: resetError } = await sendResetEmail(
      email.trim(),
      `${window.location.origin}/reset-password`
    );
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return { email, setEmail, error, loading, sent, handleSend };
}
