import { Tabs, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCoachHasPayouts } from "@/lib/useCoachHasPayouts";

export default function CoachLayout() {
  // ⚠ RENDER IS NEVER GATED ON THIS. The hook returns a plain boolean and
  // resolves every failure path to `false` (lib/useCoachHasPayouts.ts), so the
  // tab bar below renders immediately and unconditionally. A network call in
  // the coach ROOT layout has the whole app as its blast radius — Today,
  // Classes and Settings included — so nothing here may await, throw, or
  // early-return on it.
  const hasPayouts = useCoachHasPayouts();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#0ea5e9",
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#f3f4f6",
          borderTopWidth: 1,
          paddingBottom: 6,
          paddingTop: 6,
          height: 62,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="today"
        options={{
          title: "Today",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="today-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="classes"
        options={{
          title: "Classes",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
        // The attendance screen lives in THIS tab's Stack (classes/_layout.tsx)
        // but is pushed from the TODAY tab — §7.65. Switching tabs only hides a
        // stack, it never unwinds one, so the Classes stack accumulates an
        // attendance screen per lesson visited and tapping Classes lands on the
        // last lesson marked instead of the class list. §7.65 fixed the
        // within-stack half (attendance leaves via `replace`); this is the other
        // half, where the exit target is a different tab and the stack is simply
        // left behind.
        //
        // ⚠ DO NOT move this to useFocusEffect or unmountOnBlur. Both fire on
        // PROGRAMMATIC entry, which would intercept Today's "Mark Attendance"
        // push into this stack and turn the coach's most frequent daily action
        // into a dead tap that dumps them on the class list. `tabPress` fires
        // only on a real press of the tab-bar button, which is what makes it
        // safe here.
        listeners={({ navigation }) => ({
          tabPress: () => {
            // Only when arriving from ANOTHER tab. React Navigation's own
            // bottom-tabs behaviour already pops the stack to top when you
            // press the tab you are on, so repeating it here would be a
            // redundant navigation that remounts the list and throws away the
            // coach's scroll position — on the tab they open most after Today.
            // The bug this exists for is the cross-tab case, where the stack is
            // left untouched entirely.
            if (navigation.isFocused()) return;

            // ⚠ THREE APPROACHES BEFORE THIS ONE SILENTLY DID NOTHING, and the
            // driver is the only reason that was noticed — each looked correct
            // and changed no behaviour at all:
            //   1. `navigation.navigate("classes", { screen: "index" })` — no-op.
            //   2. A targeted `StackActions.popToTop()` — never fires, because
            //      expo-router does not populate nested navigator state: every
            //      route in `navigation.getState().routes` has `state:
            //      undefined`, so there is no child stack key to aim at.
            //   3. `router.dismissAll()` — `router.canDismiss()` is `false` for
            //      a tab's nested stack, and the call is a no-op.
            //
            // Deferred by a macrotask because when `tabPress` fires we are
            // still on the OUTGOING tab; acting synchronously targets the
            // stack we are leaving, not the one we are entering.
            setTimeout(() => {
              router.replace("/(coach)/classes");
            }, 0);
          },
        })}
      />
      {/* My Pay — payouts only. The coach app deliberately shows no invoices;
          everything that makes one actionable (reference, QR, reminders, the
          claim badge, mark-paid) lives on the admin panel since PRD §7.21.

          `href: null` removes the tab from the bar entirely when this coach has
          no payouts — which is the finished state for a private coach, whose
          income is their parents' invoices and who therefore has no rate
          (PRD §7.13). An empty "your pay" tab would imply setup is pending when
          nothing is. See lib/useCoachHasPayouts.ts for why the signal is
          payouts and not a rate (a coach cannot read their own rate). */}
      <Tabs.Screen
        name="pay"
        options={{
          title: "My Pay",
          href: hasPayouts ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
