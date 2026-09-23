// Moved VERBATIM from app/(auth)/forgot-password.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// app fence).
import { Platform } from "react-native";
import * as Linking from "expo-linking";

// Where Supabase should redirect the recovery link back to. On web this is the
// running Expo origin; on native it's the app's custom scheme (swimsync://).
export function resetRedirectTo(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + "/reset-password";
  }
  return Linking.createURL("/reset-password");
}
