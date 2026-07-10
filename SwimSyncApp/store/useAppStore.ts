import { create } from "zustand";

type Role = "parent" | "coach" | "superadmin" | null;

interface UserSession {
  id: string;
  email: string;
  role: Role;
  fullName: string;
}

interface AppStore {
  session: UserSession | null;
  setSession: (session: UserSession | null) => void;
  clearSession: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),
}));
