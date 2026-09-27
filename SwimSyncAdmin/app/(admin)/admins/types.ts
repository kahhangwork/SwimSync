// Admins page entity type (feature root).

export type AdminRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isOwner: boolean;
  isCoach: boolean;
  /** null = invited-vs-active not known yet (the one auth-layer fact). */
  status: "active" | "invited" | "deactivated" | null;
  /** The co-admin's role (20260927000300). null for the owner, who holds none. */
  roleId: string | null;
};

/** A role the Admins page can show or hand out. */
export type RoleOption = {
  id: string;
  name: string;
  standardKey: string | null;
  grid: import("@/lib/permissions").Grid;
};
