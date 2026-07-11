import { Stack } from "expo-router";

// Stack for the Billing tab: the invoice detail and PayNow screens are pushed
// on top of the invoices/credit-notes list — NOT their own tabs. Without this
// nested layout, expo-router hoists `billing/invoice/[id]` and `billing/paynow`
// into the parent Tabs navigator as stray tab buttons.
// Screens provide their own headers, so the native header stays hidden.
export default function BillingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
