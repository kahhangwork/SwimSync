import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Text, View } from "react-native";
import { useAppStore } from "@/store/useAppStore";

// Global toast rendered once at the root layout. Feedback shown via
// useAppStore.showToast(message, type) appears here — it works on the web build,
// unlike Alert.alert (a no-op on react-native-web). Auto-dismisses after 3s.
const COLORS: Record<string, string> = {
  success: "#16a34a",
  error: "#dc2626",
  info: "#334155",
};

export default function Toast() {
  const toast = useAppStore((s) => s.toast);
  const hideToast = useAppStore((s) => s.hideToast);
  const opacity = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setRendered(true);
    const useNative = Platform.OS !== "web";
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: useNative,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: useNative,
      }).start(() => {
        setRendered(false);
        hideToast();
      });
    }, 3000);

    return () => clearTimeout(timer);
    // Re-run whenever a new toast is pushed (id changes).
  }, [toast?.id]);

  if (!toast || !rendered) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 56,
        left: 16,
        right: 16,
        opacity,
        zIndex: 9999,
        alignItems: "center",
      }}
    >
      <View
        style={{
          backgroundColor: COLORS[toast.type] ?? COLORS.info,
          borderRadius: 12,
          paddingVertical: 12,
          paddingHorizontal: 18,
          maxWidth: 480,
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        }}
      >
        <Text
          style={{ color: "white", fontWeight: "600", textAlign: "center" }}
        >
          {toast.message}
        </Text>
      </View>
    </Animated.View>
  );
}
