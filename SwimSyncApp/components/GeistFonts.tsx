import { useEffect } from "react";
import { Platform } from "react-native";
import { Asset } from "expo-asset";
import * as Font from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { geistCss } from "@/lib/geistCss";

// DESIGN.md's type scale uses exactly these three weights (400 body, 500 label,
// 600 display/headline/buttons). `font-bold` resolves to the 600 face — DESIGN.md
// has no 700. Import per weight: the package index requires all 18 files.
const WEIGHTS: ReadonlyArray<readonly [number, number]> = [
  [400, Geist_400Regular],
  [500, Geist_500Medium],
  [600, Geist_600SemiBold],
];

// Rendered BESIDE the root <Stack/>, never around it: RootLayout's auth effect
// reads window.location.hash on first mount and router.replace throws before the
// navigator exists (UI_RESTYLE_PLAN 1.1, RISK 1). Web blocks nothing — text shows
// in the fallback until Geist swaps in.
if (Platform.OS !== "web") {
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

export default function GeistFonts() {
  useEffect(() => {
    if (Platform.OS === "web") {
      if (typeof document === "undefined" || document.getElementById("geist-fonts")) return;
      const style = document.createElement("style");
      style.id = "geist-fonts";
      style.textContent = geistCss(WEIGHTS.map(([w, mod]) => [w, Asset.fromModule(mod).uri]));
      document.head.appendChild(style);
      return;
    }

    // Native: hide the splash on load, on error (system font), or after 3 s.
    let done = false;
    const hide = () => {
      if (done) return;
      done = true;
      SplashScreen.hideAsync().catch(() => {});
    };
    const timer = setTimeout(hide, 3000);
    Font.loadAsync({ Geist: Geist_400Regular, "Geist-Medium": Geist_500Medium, "Geist-SemiBold": Geist_600SemiBold })
      .catch(() => {})
      .finally(hide);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
