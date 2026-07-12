import { create } from "zustand";

type Role = "parent" | "coach" | "superadmin" | null;

interface UserSession {
  id: string;
  email: string;
  role: Role;
  fullName: string;
}

export type ToastType = "success" | "error" | "info";

interface ToastState {
  id: number;
  message: string;
  type: ToastType;
}

interface AppStore {
  session: UserSession | null;
  setSession: (session: UserSession | null) => void;
  clearSession: () => void;
  // Global toast — used for user feedback that works on web too (Alert.alert is
  // a no-op on react-native-web). See components/Toast.tsx.
  toast: ToastState | null;
  showToast: (message: string, type?: ToastType) => void;
  hideToast: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),
  toast: null,
  showToast: (message, type = "info") =>
    set({ toast: { id: Date.now(), message, type } }),
  hideToast: () => set({ toast: null }),
}));
