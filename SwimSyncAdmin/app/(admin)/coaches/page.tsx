"use client";

import { useEffect, useState } from "react";
import { Plus, QrCode } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";

type CoachRow = {
  id: string;
  profile_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  paynow_qr_url: string | null;
  class_titles: string[];
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
        "id, profile_id, tenants(paynow_qr_url), profiles(full_name, email, phone), classes(title, is_active)"
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
<Th>Name</Th>
            <Th>Email</Th>
            <Th>Phone</Th>
            <Th>Classes</Th>
            <Th>PayNow QR</Th>
            <Th>Actions</Th>
</Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
                Loading…
              </Td>
            </Tr>
          ) : coaches.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-8" colSpan={6}>
                No coaches yet.
              </Td>
            </Tr>
          ) : (
            coaches.map((coach) => (
              <Tr key={coach.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700 text-sm font-bold">
                      {coach.full_name.charAt(0)}
                    </div>
                    <span className="font-medium text-gray-900">
                      {coach.full_name}
                    </span>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setQrModal(coach)}
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    QR
                  </Button>
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
