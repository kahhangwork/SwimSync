// The coach Settings tab's QR upload transport (docs/refactor/BATCH_FGH_PLAN.md,
// App L-H): reading the picked image into bytes, the Storage upload and the
// public URL — each byte-identical to the call it replaced in
// app/(coach)/settings/index.tsx. The try/finally, the throw on error and the
// cache-bust stay in domain/useCoachSettings.
//
// dao/ is transport only (fence check 2).
import { supabase } from "@/lib/supabase";

// Read the picked image into bytes (works on web + native).
export const readImageBytes = async (uri: string) =>
  (await fetch(uri)).arrayBuffer();

export const uploadQrImage = (path: string, bytes: ArrayBuffer, contentType: string) =>
  supabase.storage
    .from("paynow-qr")
    .upload(path, bytes, { contentType, upsert: true });

// Public bucket → render without a signed URL.
export const qrPublicUrl = (path: string) =>
  supabase.storage
    .from("paynow-qr")
    .getPublicUrl(path);
