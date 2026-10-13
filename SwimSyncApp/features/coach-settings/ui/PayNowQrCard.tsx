// PayNow QR: the PayNow-ID status and the always-reachable fallback-image upload.
// Moved from app/(coach)/settings/index.tsx (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H); restyled in UI restyle step 2.7: a set PayNow ID is Success, a missing
// one Warning (it needs doing), and the fallback upload is a secondary button.
import React from "react";
import { View, Text, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Surface } from "@/components/ui/Surface";
import { Button } from "@/components/ui/Button";
import type { useCoachSettings } from "../domain/useCoachSettings";

type Settings = ReturnType<typeof useCoachSettings>;

export function PayNowQrCard(p: Pick<Settings, "hasPaynowId" | "showQrUpload" | "setShowQrUpload" | "paynowUrl" | "uploading" | "handleUploadQR">) {
  const { hasPaynowId, showQrUpload, setShowQrUpload, paynowUrl, uploading, handleUploadQR } = p;
  return (
    <>
      {/* PayNow QR Management */}
      <Surface className="mb-4">
        <View className="flex-row items-center gap-2 mb-3">
          <Ionicons name="qr-code-outline" size={20} color="#0a0a0a" />
          <Text className="text-headline font-semibold text-ink">
            PayNow QR Code
          </Text>
        </View>

        {hasPaynowId ? (
          <View className="rounded-control border border-status-success-border bg-status-success-bg p-3 mb-3">
            <Text className="text-body-secondary text-ink">
              Your PayNow ID is set. Parents get a QR with the amount and
              reference already filled in, so payments arrive matched to the
              right bill.
            </Text>
          </View>
        ) : (
          <View className="rounded-control border border-status-warning-border bg-status-warning-bg p-3 mb-3">
            <Text className="text-body-secondary text-ink">
              No PayNow ID set yet. Add your PayNow UEN or mobile in the admin
              panel (Invoices → PayNow) and parents get a QR with the amount
              and reference filled in automatically.
            </Text>
          </View>
        )}

        {/* The uploaded image. ALWAYS present, never conditionally removed —
            it is the only writer of tenants.paynow_qr_url anywhere in the
            product, and it is the last resort for native builds and for a
            PayNow ID that cannot be encoded. Collapsed, so it stops being
            the primary affordance without becoming unreachable. */}
        <TouchableOpacity
          onPress={() => setShowQrUpload((v) => !v)}
          className="min-h-11 flex-row items-center gap-1"
          activeOpacity={0.7}
        >
          <Ionicons
            name={showQrUpload ? "chevron-down" : "chevron-forward"}
            size={14}
            color="#525252"
          />
          <Text className="text-body-secondary font-medium text-ink-secondary">
            Fallback QR image — advanced
          </Text>
        </TouchableOpacity>

        {showQrUpload && (
          <View className="mt-3">
            <Text className="text-body-secondary text-ink-secondary mb-3">
              Used only when a PayNow ID is not set or cannot be turned into a
              QR. The amount and reference are not filled in, so parents type
              them by hand.
            </Text>

            {paynowUrl ? (
              <View className="items-center mb-4">
                <Image
                  source={{ uri: paynowUrl }}
                  className="w-36 h-36 rounded-card border border-border mb-3"
                  resizeMode="contain"
                />
                <Text className="text-body-secondary text-ink-secondary">
                  Parents see this when no PayNow ID QR can be built.
                </Text>
              </View>
            ) : null}

            <Button
              variant="secondary"
              label={
                uploading
                  ? "Uploading…"
                  : paynowUrl
                  ? "Replace QR Code"
                  : "Upload QR Code"
              }
              onPress={handleUploadQR}
            />
          </View>
        )}
      </Surface>
    </>
  );
}
