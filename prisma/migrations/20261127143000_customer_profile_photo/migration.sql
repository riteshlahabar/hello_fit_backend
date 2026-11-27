-- Customer profile photo.
--
-- A customer's photo is the same shape as a provider's (`instructor_profiles.photo_url`):
-- a permanent public URL under the storage port's `public/` prefix, so it can be drawn
-- without a signed link. Nullable, because initials are the fallback and no existing row
-- has a photo.
ALTER TABLE "customer_profiles" ADD COLUMN "photo_url" TEXT;
