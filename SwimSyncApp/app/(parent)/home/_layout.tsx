import { Stack } from "expo-router";

// Stack for the Home tab: add-child and the child detail screen are pushed on
// top of the children list — NOT their own tabs. Without this nested layout,
// expo-router hoists `home/add-child` and `home/child/[id]` into the parent
// Tabs navigator as stray tab buttons.
// Screens provide their own headers, so the native header stays hidden.
export default function HomeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
