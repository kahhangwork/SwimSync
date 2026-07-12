import { Alert, Platform } from "react-native";

// Cross-platform confirm dialog. `Alert.alert` renders nothing on React-Native
// web (it's a no-op), so a native-only confirm silently swallows the action —
// e.g. Sign Out did nothing on the web build. On web we fall back to the
// browser's window.confirm; on native we keep the styled Alert.
export function confirmAction(
  title: string,
  message: string,
  onConfirm: () => void,
  confirmLabel = "OK"
): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(message)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}
