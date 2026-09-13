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
};
