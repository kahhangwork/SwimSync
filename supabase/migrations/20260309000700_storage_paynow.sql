-- ============================================================
-- Storage bucket for coach PayNow QR images.
--
-- Public read (parents need to render the QR without a signed URL);
-- writes are restricted to the owning coach. Files are namespaced by
-- coach: the first path segment must be the coach's own id, e.g.
--   paynow-qr/<coach_id>/qr.png
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('paynow-qr', 'paynow-qr', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Public read of QR images
CREATE POLICY "paynow_qr_public_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'paynow-qr');

-- A coach may write only into their own folder (first path segment
-- = their coaches.id). Superadmin may write anywhere in the bucket.
CREATE POLICY "paynow_qr_coach_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'paynow-qr'
    AND (
      is_superadmin()
      OR (storage.foldername(name))[1] = current_coach_id()::text
    )
  );

CREATE POLICY "paynow_qr_coach_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'paynow-qr'
    AND (
      is_superadmin()
      OR (storage.foldername(name))[1] = current_coach_id()::text
    )
  );

CREATE POLICY "paynow_qr_coach_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'paynow-qr'
    AND (
      is_superadmin()
      OR (storage.foldername(name))[1] = current_coach_id()::text
    )
  );
