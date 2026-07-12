import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // On web, let supabase-js parse the recovery/OAuth token from the URL hash
    // (drives the password-reset landing). On native we handle the deep link
    // ourselves in app/_layout.tsx.
    detectSessionInUrl: Platform.OS === "web",
  },
});
