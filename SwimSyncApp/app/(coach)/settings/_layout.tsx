import { Stack } from "expo-router";

// Nested stack so this tab folder collapses to a clean route that binds its
// <Tabs.Screen> title/icon (and contains any future detail screens instead of
// leaking them as tabs). Screens provide their own headers.
export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
