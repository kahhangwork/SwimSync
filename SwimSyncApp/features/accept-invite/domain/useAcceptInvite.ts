// The Accept Invite screen's state, the invite-session check and the first password
// (docs/refactor/BATCH_FGH_PLAN.md, app fence). Moved VERBATIM from
// app/(auth)/accept-invite.tsx — the auth calls and the two writes are dao calls; the
// mount effect ([] deps) and the sign-out-then-sign-in sequence are unchanged.
import { useEffect, useState } from "react";
import { router } from "expo-router";
import { friendlyAuthError } from "@/lib/authErrors";
import { useAppStore } from "@/store/useAppStore";
import { getSession, updatePassword, getUser, signOut } from "../dao/acceptInvite.auth";
import { fetchInvitedChildName, updateInvitedProfile } from "../dao/acceptInvite.repo";

export function useAcceptInvite() {
  // ⚠ THE NAME IS COLLECTED HERE, AND IT MUST BE. An invited parent never sees
  // the registration form, so before this screen asked, their profile name was
  // permanently blank — and the coach's roster then showed a child with no
  // parent name against it, which reads as "nobody has claimed this child"
  // when somebody has. Reported from production 2026-07-26.
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [childName, setChildName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showToast = useAppStore((s) => s.showToast);

  useEffect(() => {
    getSession().then(async ({ data: { session } }) => {
      if (!session) {
        showToast(
          "This invite link is invalid or has already been used. Ask your coach to send a new one.",
          "error"
        );
        router.replace("/(auth)/login");
        return;
      }

      // Name the child, because it is the proof this is really their invite —
      // a stranger's link would name a child they do not recognise. Failure is
      // non-fatal: the password still needs setting either way.
      const { data: kids } = await fetchInvitedChildName();
      setChildName(kids?.[0]?.full_name ?? null);
      setChecking(false);
    });
  }, []);

  async function handleSetPassword() {
    setError(null);
    if (!fullName.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!password || !confirm) {
      setError("Please enter and confirm a password.");
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

    setLoading(true);
    const { error: updErr } = await updatePassword(password);
    if (updErr) {
      setLoading(false);
      setError(friendlyAuthError(updErr));
      return;
    }

    // Written while the invite session is still valid — this is the only moment
    // we are certainly signed in as them. Best-effort: a failure here must not
    // strand someone who has just set a password, and Profile → Contact Details
    // can fix it afterwards. The phone is optional but worth asking for: it is
    // one of the two signals that matches a family to a child their coach
    // already put on the roster.
    const { data: me } = await getUser();
    if (me.user) {
      await updateInvitedProfile(me.user.id, {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
      });
    }

    // Sign out and back in, exactly as the reset flow does: the invite session
    // exists to set a password, and a clean login proves the password works
    // before the parent depends on it.
    await signOut();
    setLoading(false);
    showToast("Password set. Please sign in.", "success");
    router.replace("/(auth)/login");
  }

  return {
    fullName,
    setFullName,
    phone,
    setPhone,
    password,
    setPassword,
    confirm,
    setConfirm,
    loading,
    checking,
    childName,
    error,
    handleSetPassword,
  };
}
