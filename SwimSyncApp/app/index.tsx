import { Redirect } from "expo-router";

// Entry point — redirect to auth login
export default function Index() {
  return <Redirect href="/(auth)/login" />;
}
