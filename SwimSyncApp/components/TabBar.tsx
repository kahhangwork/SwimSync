import { useMemo } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// DESIGN.md → Mobile tab bar: white, 1px top border, 64px + the bottom safe
// area; labels 12px Ink Secondary; the active tab is Ink at 600 WITH a 2px Lane
// Blue indicator — never shade alone. Shared by the coach and parent layouts.
// Hex, not classes: React Navigation takes style objects, not className.
const INK = "#0a0a0a";
const INK_SECONDARY = "#525252";
const LANE_BLUE = "#2563eb";
const BORDER = "#e5e5e5";

export function useTabScreenOptions(): BottomTabNavigationOptions {
  const bottom = useSafeAreaInsets().bottom;
  // Memoised: the coach layout re-renders when useCoachHasPayouts resolves, and
  // a fresh screenOptions object makes every tab re-read its options.
  return useMemo(() => ({
    headerShown: false,
    tabBarActiveTintColor: INK,
    tabBarInactiveTintColor: INK_SECONDARY,
    tabBarStyle: {
      backgroundColor: "#ffffff",
      borderTopColor: BORDER,
      borderTopWidth: 1,
      height: 64 + bottom,
      paddingBottom: bottom,
    },
    // ⚠ The label stays a bare <Text> returned straight into the tab's
    // pressable (BottomTabItem renders [icon, label] in a Fragment):
    // pressByText dispatches on the leaf's PARENT, and 19 app drivers press a
    // tab by its label. Wrap it in a View and every one of them misses.
    // lineHeight 16 is the descender fix ("Settinas", "Billina").
    tabBarLabel: ({ focused, color, children }) => (
      <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: focused ? "600" : "500", color }}>
        {children}
      </Text>
    ),
  }), [bottom]);
}

export function tabIcon(name: keyof typeof Ionicons.glyphMap) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <View style={{ alignItems: "center" }}>
      {/* -8 lifts the 2px line from the icon's top to the bar's top border
          (measured at 390px: the bar's 64px less the icon + label stack). */}
      {focused && (
        <View
          style={{ position: "absolute", top: -8, width: 24, height: 2, borderRadius: 1, backgroundColor: LANE_BLUE }}
        />
      )}
      <Ionicons name={name} size={22} color={color} />
    </View>
  );
}
