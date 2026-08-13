"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, QrCode, UserX, UserCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { todayInSg } from "@/lib/lessonDates";
import {
  unmarkedOverrideLessons,
  type OverrideSession,
  type UnmarkedOverrideLesson,
} from "@/lib/coachDisableImpact";

type CoachRow = {
  id: string;
  profile_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  paynow_qr_url: string | null;
  class_titles: string[];
  disabled_at: string | null;
};

function Field({
  label,
  placeholder,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
    </div>
  );
}

export default function CoachesPage() {
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [qrModal, setQrModal] = useState<CoachRow | null>(null);

  // Disable / reactivate (Wave 5 chunk 2). The RPC is the boundary — these
  // dialogs are the UX affordance, and their job is to surface its refusals
  // PLAINLY (⚠ RISK 7: set_class_terms's own money-guard messages included).
  const [disableModal, setDisableModal] = useState<CoachRow | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [impact, setImpact] = useState<UnmarkedOverrideLesson[] | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [reactivateModal, setReactivateModal] = useState<CoachRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const impactCoachRef = useRef<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    loadCoaches();
  }, []);

  async function loadCoaches() {
    setLoading(true);
    const { data } = await supabase
      .from("coaches")
      // The PayNow QR is the BUSINESS's, not each coach's — a school has one
      // bank account. Read through the coach's tenant so every coach in a
      // school shows the same, correct payee.
      .select(
        "id, profile_id, disabled_at, tenants(paynow_qr_url), profiles(full_name, email, phone), classes(title, is_active)"
      )
      .order("id");

    setCoaches(
      (data ?? []).map((c: any) => ({
        id: c.id,
        profile_id: c.profile_id,
        full_name: c.profiles?.full_name ?? "—",
        email: c.profiles?.email ?? "—",
        phone: c.profiles?.phone ?? null,
        paynow_qr_url:
          (Array.isArray(c.tenants) ? c.tenants[0] : c.tenants)?.paynow_qr_url ?? null,
        class_titles: (c.classes ?? [])
          .filter((cls: any) => cls.is_active)
          .map((cls: any) => cls.title),
        disabled_at: c.disabled_at ?? null,
      }))
    );
    setLoading(false);
  }

  async function handleCreate() {
    if (!name || !email || !password) {
      setCreateError("Name, email and password are required.");
      return;
    }
    setCreating(true);
    setCreateError(null);

    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/create-coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ name, email, phone, password }),
    });

    const json = await res.json();
    if (!res.ok) {
      setCreateError(json.error ?? "Failed to create coach.");
      setCreating(false);
      return;
    }

    setCreating(false);
    setShowCreate(false);
    setName("");
    setEmail("");
    setPhone("");
    setPassword("");
    loadCoaches();
  }

  function openDisable(coach: CoachRow) {
    setDisableModal(coach);
    setReplacementId("");
    setActionError(null);
    setImpact(null);
    setImpactError(null);
    loadImpact(coach);
  }

  // The ⚠ RISK 8 list: PAST/TODAY lessons whose substitute override names this
  // coach and which are not fully marked. After the disable, only an ADMIN can
  // mark them — and an unmarked lesson blocks the whole invoice run, with no
  // override (PRD §7.7). Same query shapes as the invoice pre-flight; the
  // completeness rule itself comes from lib/attendanceCompleteness (§7.18: one
  // definition, never re-derived).
  async function loadImpact(coach: CoachRow) {
    impactCoachRef.current = coach.id;
    const isStale = () => impactCoachRef.current !== coach.id;
    try {
      const scRes = await supabase
        .from("session_coaches")
        .select(
          "lesson_sessions(id, class_id, session_date, classes(title))"
        )
        .eq("coach_id", coach.id);
      if (scRes.error) throw scRes.error;

      const today = todayInSg();
      const sessions: OverrideSession[] = (scRes.data ?? [])
        .map((r: any) => {
          const ls = Array.isArray(r.lesson_sessions)
            ? r.lesson_sessions[0]
            : r.lesson_sessions;
          if (!ls) return null;
          const cls = Array.isArray(ls.classes) ? ls.classes[0] : ls.classes;
          return {
            id: ls.id,
            class_id: ls.class_id,
            title: cls?.title ?? "—",
            session_date: ls.session_date,
          };
        })
        .filter((s: OverrideSession | null): s is OverrideSession => s !== null)
        .filter((s) => s.session_date <= today);

      if (sessions.length === 0) {
        if (!isStale()) setImpact([]);
        return;
      }

      const classIds = [...new Set(sessions.map((s) => s.class_id))];
      const sessionIds = sessions.map((s) => s.id);
      const dates = [...new Set(sessions.map((s) => s.session_date))];

      const [enrRes, attRes, triRes, mkRes] = await Promise.all([
        supabase
          .from("student_class_enrolments")
          .select("class_id, student_id, is_active, enrolled_at, unenrolled_at")
          .in("class_id", classIds),
        supabase
          .from("attendance")
          .select("lesson_session_id, student_id")
          .in("lesson_session_id", sessionIds),
        supabase
          .from("trial_bookings")
          .select("class_id, student_id, session_date")
          .in("class_id", classIds)
          .in("session_date", dates)
          .is("cancelled_at", null),
        supabase
          .from("makeup_bookings")
          .select("class_id, student_id, session_date")
          .in("class_id", classIds)
          .in("session_date", dates)
          .is("cancelled_at", null),
      ]);
      if (enrRes.error) throw enrRes.error;
      if (attRes.error) throw attRes.error;
      if (triRes.error) throw triRes.error;
      if (mkRes.error) throw mkRes.error;

      if (isStale()) return;
      setImpact(
        unmarkedOverrideLessons(
          sessions,
          enrRes.data ?? [],
          attRes.data ?? [],
          [...(triRes.data ?? []), ...(mkRes.data ?? [])],
          today
        )
      );
    } catch (e) {
      if (isStale()) return;
      // An unreadable list must not read as an empty one — the admin would
      // disable believing nothing falls to them.
      setImpactError(
        e instanceof Error ? e.message : "could not read the marking backlog"
      );
    }
  }

  async function handleDisable() {
    if (!disableModal) return;
    if (disableModal.class_titles.length > 0 && !replacementId) return;
    setActionBusy(true);
    setActionError(null);

    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/disable-coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({
        coachId: disableModal.id,
        replacementCoachId: replacementId || null,
      }),
    });
    const json = await res.json();
    setActionBusy(false);
    if (!res.ok) {
      setActionError(json.error ?? "Failed to disable the coach.");
      return;
    }
    setDisableModal(null);
    loadCoaches();
  }

  async function handleReactivate() {
    if (!reactivateModal) return;
    setActionBusy(true);
    setActionError(null);

    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/reactivate-coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ coachId: reactivateModal.id }),
    });
    const json = await res.json();
    setActionBusy(false);
    if (!res.ok) {
      setActionError(json.error ?? "Failed to reactivate the coach.");
      return;
    }
    setReactivateModal(null);
    loadCoaches();
  }

  const replacementOptions = coaches.filter(
    (c) => c.id !== disableModal?.id && !c.disabled_at
  );

  const sort = useTableSort<CoachRow>({
    key: "full_name",
    accessors: {
      classes: (c) => c.class_titles.length,
      // Missing QRs first when ascending: a business with no QR cannot be paid,
      // which makes it the row worth surfacing, not the row worth hiding.
      paynow_qr_url: (c) => Boolean(c.paynow_qr_url),
    },
  });
  const visible = sort.apply(coaches);

  return (
    <div>
      <PageHeader
        title="Coaches"
        subtitle={`${coaches.length} coaches`}
        action={
          <Button
            onClick={() => {
              setName("");
              setEmail("");
              setPhone("");
              setPassword("");
              setCreateError(null);
              setShowCreate(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Coach
          </Button>
        }
      />

      <Table>
        <Thead>
          <Th sort={sort} sortKey="full_name">Name</Th>
          <Th sort={sort} sortKey="email">Email</Th>
          <Th sort={sort} sortKey="phone">Phone</Th>
          <Th sort={sort} sortKey="classes">Classes</Th>
          <Th sort={sort} sortKey="paynow_qr_url">PayNow QR</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
                Loading…
              </Td>
            </Tr>
          ) : visible.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
                No coaches yet.
              </Td>
            </Tr>
          ) : (
            visible.map((coach) => (
              <Tr key={coach.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                        coach.disabled_at
                          ? "bg-gray-100 text-gray-400"
                          : "bg-sky-100 text-sky-700"
                      }`}
                    >
                      {coach.full_name.charAt(0)}
                    </div>
                    <span
                      className={`font-medium ${
                        coach.disabled_at ? "text-gray-400" : "text-gray-900"
                      }`}
                    >
                      {coach.full_name}
                    </span>
                    {coach.disabled_at && (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
                        Disabled
                      </span>
                    )}
                  </div>
                </Td>
                <Td className="text-gray-500">{coach.email}</Td>
                <Td className="text-gray-500">{coach.phone ?? "—"}</Td>
                <Td>
                  {coach.class_titles.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {coach.class_titles.map((t) => (
                        <span key={t} className="text-xs text-gray-600">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">No classes</span>
                  )}
                </Td>
                <Td>
                  {coach.paynow_qr_url ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                      <QrCode className="h-3 w-3" /> Uploaded
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-600">
                      Missing
                    </span>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setQrModal(coach)}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      QR
                    </Button>
                    {coach.disabled_at ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setActionError(null);
                          setReactivateModal(coach);
                        }}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Reactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => openDisable(coach)}
                      >
                        <UserX className="h-3.5 w-3.5" />
                        Disable
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      {/* Create Coach Modal */}
      <Modal
        title="Create Coach Account"
        open={showCreate}
        onClose={() => setShowCreate(false)}
      >
        <div className="space-y-4">
          <Field
            label="Full Name"
            placeholder="Marcus Lim"
            value={name}
            onChange={setName}
          />
          <Field
            label="Email"
            placeholder="coach@swimsync.sg"
            type="email"
            value={email}
            onChange={setEmail}
          />
          <Field
            label="Phone"
            placeholder="+65 9876 5432"
            value={phone}
            onChange={setPhone}
          />
          <Field
            label="Temp Password"
            placeholder="••••••••"
            type="password"
            value={password}
            onChange={setPassword}
          />

          {createError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {createError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={creating}
              onClick={handleCreate}
            >
              {creating ? "Creating…" : "Create Account"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Disable Coach Modal */}
      <Modal
        title={`Disable ${disableModal?.full_name ?? ""}?`}
        open={!!disableModal}
        onClose={() => setDisableModal(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Their coach access ends immediately and their login is blocked.
            Their taught lessons and past pay are untouched — disabling is
            forward-looking.
          </p>

          {disableModal && disableModal.class_titles.length > 0 && (
            <div>
              <p className="text-sm text-gray-700 mb-2">
                They still teach{" "}
                <span className="font-medium">
                  {disableModal.class_titles.join(", ")}
                </span>
                . Choose a replacement — the handover and the disable happen in
                one step, or not at all.
              </p>
              <select
                value={replacementId}
                onChange={(e) => setReplacementId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Choose the replacement coach…</option>
                {replacementOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
              {replacementOptions.length === 0 && (
                <p className="mt-2 text-sm text-gray-500">
                  No other active coach to hand these classes to — hire or
                  reactivate one first.
                </p>
              )}
            </div>
          )}

          {/* ⚠ RISK 8: unmarked lessons whose substitute override names this
              coach. After the disable only an admin can mark them, and an
              unmarked lesson blocks billing with no override. */}
          {impactError ? (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              Could not check their unmarked lessons: {impactError}
            </p>
          ) : impact === null ? (
            <p className="text-sm text-gray-400">Checking unmarked lessons…</p>
          ) : impact.length > 0 ? (
            <div className="rounded-xl bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800 mb-1">
                Marking these falls to you (admin) after disabling:
              </p>
              <ul className="text-sm text-amber-700 space-y-0.5">
                {impact.map((l) => (
                  <li key={l.sessionId}>
                    {l.sessionDate} — {l.title} ({l.unmarkedCount} unmarked)
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {actionError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {actionError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDisableModal(null)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700"
              disabled={
                actionBusy ||
                ((disableModal?.class_titles.length ?? 0) > 0 && !replacementId)
              }
              onClick={handleDisable}
            >
              {actionBusy ? "Disabling…" : "Disable coach"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reactivate Coach Modal */}
      <Modal
        title={`Reactivate ${reactivateModal?.full_name ?? ""}?`}
        open={!!reactivateModal}
        onClose={() => setReactivateModal(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Their login and coach access return immediately. Classes handed
            over when they were disabled are <strong>not</strong> handed back —
            reassign any class deliberately from the Classes page.
          </p>

          {actionError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {actionError}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setReactivateModal(null)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={actionBusy}
              onClick={handleReactivate}
            >
              {actionBusy ? "Reactivating…" : "Reactivate coach"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* PayNow QR Modal */}
      <Modal
        title={`${qrModal?.full_name ?? ""} — PayNow QR`}
        open={!!qrModal}
        onClose={() => setQrModal(null)}
      >
        <div className="flex flex-col items-center gap-4">
          {qrModal?.paynow_qr_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrModal.paynow_qr_url}
              alt="PayNow QR"
              className="w-44 h-44 rounded-2xl object-contain"
            />
          ) : (
            <div className="rounded-xl bg-yellow-50 p-4 text-sm text-yellow-700 w-full text-center">
              No PayNow QR uploaded for this coach yet.
            </div>
          )}
          <p className="text-xs text-gray-400 text-center">
            To upload or replace a QR code, use the coach&apos;s Settings screen
            in the mobile app.
          </p>
        </div>
      </Modal>
    </div>
  );
}
