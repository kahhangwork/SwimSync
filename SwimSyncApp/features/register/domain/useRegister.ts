// The Register screen's form state and its submit (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H). Moved VERBATIM from app/(auth)/register.tsx; the three builders are
// dao calls now.
//
// ⚠ plan R10 — the ORDER is the contract: validate → signUp (join code in
// user_metadata) → best-effort phone → best-effort address → `!data.session`
// check → setSession → replace. Production runs with email confirmation OFF
// (mailer_autoconfirm, §7.232), which is the branch the drivers exercise.
import { useState } from "react";
import { router } from "expo-router";
import { useAppStore } from "@/store/useAppStore";
import { friendlyAuthError } from "@/lib/authErrors";
import { signUp } from "../dao/register.auth";
import { updateProfilePhone, updateParentAddress } from "../dao/register.repo";

export function useRegister() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [postal, setPostal] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const setSession = useAppStore((s) => s.setSession);

  async function handleRegister() {
    setError(null);

    if (!name || !email || !phone || !password || !confirm) {
      setError("Please fill in all required fields.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    // Address and postal code are OPTIONAL — see below. Only the format is
    // policed, and only when something was actually typed.
    if (postal.trim() && !/^[0-9]{6}$/.test(postal.trim())) {
      setError("Postal code should be 6 digits.");
      return;
    }

    setLoading(true);

    const { data, error: signUpError } = await signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: name.trim(),
          role: "parent",
          // The code MUST travel in user_metadata: when email confirmation is
          // on there is no session, so the post-signup updates below silently
          // fail. handle_new_user copies it to parents.signup_join_code; the
          // parent home applies it once on first sign-in.
          join_code: joinCode.trim() || undefined,
        },
      },
    });

    if (signUpError || !data.user) {
      setLoading(false);
      setError(friendlyAuthError(signUpError));
      return;
    }

    // Update phone in profiles
    await updateProfilePhone(data.user.id, phone.trim());

    // Address lives on `parents`, not `profiles`: profiles is shared with
    // coaches and admins, and a home address is a parent-shaped fact. Written
    // after signup because the auth trigger is what creates the parents row.
    //
    // Best-effort, exactly like the phone update above: a failure here must
    // never strand someone mid-registration with an account they cannot reach.
    // They can supply it later from their profile.
    if (address.trim() || postal.trim()) {
      await updateParentAddress(data.user.id, {
        address: address.trim() || null,
        postal_code: postal.trim() || null,
      });
    }

    setLoading(false);

    // If email confirmation is enabled, no session is returned. Show an inline
    // "check your email" state — Alert.alert is a no-op on the web build, which
    // would otherwise strand the user on the form with no feedback or redirect.
    if (!data.session) {
      setEmailSent(true);
      return;
    }

    // Email confirmation disabled → session returned immediately
    setSession({
      id: data.user.id,
      email: data.user.email!,
      role: "parent",
      fullName: name.trim(),
    });

    router.replace("/(parent)/home");
  }

  return {
    name,
    setName,
    email,
    setEmail,
    phone,
    setPhone,
    address,
    setAddress,
    postal,
    setPostal,
    joinCode,
    setJoinCode,
    password,
    setPassword,
    confirm,
    setConfirm,
    loading,
    error,
    emailSent,
    handleRegister,
  };
}
