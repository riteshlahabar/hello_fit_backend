-- HelloFit — the three plan tiers (PDF §5.4).
--
-- Generated from the local database, so what runs here is exactly what the
-- site already serves locally. Covers both tables: `plans` and its child
-- `plan_features`.
--
-- SAFE TO RE-RUN. `slug` is the natural key, so a second run updates the
-- three rows in place instead of duplicating them, and each plan's feature
-- list is replaced wholesale so a line removed here disappears there too.
-- The ids are carried across deliberately: the two databases then agree, and
-- anything already pointing at a plan keeps pointing at it.
--
-- Needs pgcrypto for gen_random_uuid(); it is built in from PostgreSQL 13.
--
--   psql "$DATABASE_URL" -f seed-plans.sql

BEGIN;

-- Starter — ₹0/month
INSERT INTO plans (
  id, name, slug, icon, eyebrow, description,
  price_monthly, price_yearly, billing_caption,
  is_popular, sort_order, is_active, created_at, updated_at
) VALUES (
  'b4850e31-8596-40c1-992c-5ea619aa1c14'::uuid, 'Starter', 'starter', '🌱', 'Start strong', 'For building a consistent fitness habit, one session at a time.',
  0, 0, 'No membership fee',
  false, 0, true, now(), now()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, icon = EXCLUDED.icon, eyebrow = EXCLUDED.eyebrow,
  description = EXCLUDED.description, price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly, billing_caption = EXCLUDED.billing_caption,
  is_popular = EXCLUDED.is_popular, sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active, deleted_at = NULL, updated_at = now();

DELETE FROM plan_features WHERE plan_id = (SELECT id FROM plans WHERE slug = 'starter');
INSERT INTO plan_features (id, plan_id, label, included, sort_order, created_at, updated_at) VALUES
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'starter'), 'Book individual trainer sessions', true, 0, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'starter'), 'Access trainer profiles & reviews', true, 1, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'starter'), 'Manage bookings in your dashboard', true, 2, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'starter'), 'Standard customer support', true, 3, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'starter'), 'Member-only offers', false, 4, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'starter'), 'Priority support', false, 5, now(), now());

-- Plus — ₹499/month  (carries the MOST POPULAR ribbon)
INSERT INTO plans (
  id, name, slug, icon, eyebrow, description,
  price_monthly, price_yearly, billing_caption,
  is_popular, sort_order, is_active, created_at, updated_at
) VALUES (
  '4fb173a5-8270-466c-881b-1e5dbbdade37'::uuid, 'Plus', 'plus', '🔥', 'Build momentum', 'For members who want extra perks to keep their routine on track.',
  499, 399, 'Billed monthly · Cancel anytime',
  true, 1, true, now(), now()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, icon = EXCLUDED.icon, eyebrow = EXCLUDED.eyebrow,
  description = EXCLUDED.description, price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly, billing_caption = EXCLUDED.billing_caption,
  is_popular = EXCLUDED.is_popular, sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active, deleted_at = NULL, updated_at = now();

DELETE FROM plan_features WHERE plan_id = (SELECT id FROM plans WHERE slug = 'plus');
INSERT INTO plan_features (id, plan_id, label, included, sort_order, created_at, updated_at) VALUES
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'plus'), 'Member-only booking offers', true, 0, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'plus'), 'Early access to selected slots', true, 1, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'plus'), 'Monthly progress check-in', true, 2, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'plus'), 'Priority customer support', true, 3, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'plus'), 'Exclusive fitness tips', true, 4, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'plus'), 'Dedicated fitness concierge', false, 5, now(), now());

-- Premium — ₹999/month
INSERT INTO plans (
  id, name, slug, icon, eyebrow, description,
  price_monthly, price_yearly, billing_caption,
  is_popular, sort_order, is_active, created_at, updated_at
) VALUES (
  '1c93151b-74de-4a84-88a1-4216d47d70ef'::uuid, 'Premium', 'premium', '👑', 'Go all in', 'For a more supported experience with elevated member benefits.',
  999, 799, 'Billed monthly · Cancel anytime',
  false, 2, true, now(), now()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, icon = EXCLUDED.icon, eyebrow = EXCLUDED.eyebrow,
  description = EXCLUDED.description, price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly, billing_caption = EXCLUDED.billing_caption,
  is_popular = EXCLUDED.is_popular, sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active, deleted_at = NULL, updated_at = now();

DELETE FROM plan_features WHERE plan_id = (SELECT id FROM plans WHERE slug = 'premium');
INSERT INTO plan_features (id, plan_id, label, included, sort_order, created_at, updated_at) VALUES
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'premium'), 'Dedicated fitness concierge', true, 0, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'premium'), 'Personalised monthly goal review', true, 1, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'premium'), 'Premium member-only offers', true, 2, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'premium'), 'Priority help with booking changes', true, 3, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'premium'), 'Enhanced progress insights', true, 4, now(), now()),
  (gen_random_uuid(), (SELECT id FROM plans WHERE slug = 'premium'), 'Early access to new features', true, 5, now(), now());

COMMIT;

-- Check:
--   SELECT slug, name, price_monthly, price_yearly, is_popular, sort_order FROM plans WHERE deleted_at IS NULL ORDER BY sort_order;
--   SELECT p.slug, count(*) FROM plan_features f JOIN plans p ON p.id = f.plan_id GROUP BY p.slug;
-- Expect three rows, six features each.
