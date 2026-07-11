import { Stack } from "expo-router";

// Stack for the Classes tab: roster and attendance are detail screens pushed
// on top of the class list — NOT their own tabs. Without this nested layout,
// expo-router hoists `classes/[id]/roster` and `classes/[id]/attendance` into
// the parent Tabs navigator, rendering stray tab buttons.
// Screens provide their own headers, so the native header stays hidden.
export default function ClassesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
