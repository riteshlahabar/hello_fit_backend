-- HelloFit real catalogue — the client's "Complete Trainer Pricing Guideline"
-- (17 Nov 2026) and its Yoga group sheet, as the client settled them on
-- 18 Nov: the four trainer tiers are the Gym category, and group yoga is one
-- service priced by slab.
--
-- Run on the VPS:
--     psql "$DATABASE_URL" -f prisma/seeds/seed-catalogue.sql
--
-- **Idempotent.** Every row matches on its natural key (slug, package name,
-- min_persons) and is updated rather than duplicated, so a second run changes
-- nothing. It creates and updates only; it deletes nothing, because a booked
-- service must keep its bookings explicable. Retire an unwanted row from the
-- admin panel instead (Catalog → Services → Hide).
--
-- `updated_at` is set by hand everywhere: Prisma's @updatedAt lives in the
-- client, not in the column, so the database has no default for it.

BEGIN;

-- ---------------------------------------------------------------- categories
INSERT INTO service_categories (id, name, slug, sort_order, is_active, updated_at)
VALUES
  (gen_random_uuid(), 'Gym',  'gym',  0, true, now()),
  (gen_random_uuid(), 'Yoga', 'yoga', 1, true, now())
ON CONFLICT (slug) DO UPDATE
SET name       = EXCLUDED.name,
    sort_order = EXCLUDED.sort_order,
    is_active  = true,
    deleted_at = NULL,
    updated_at = now();

-- ------------------------------------------------------------------ services
-- Gym: section 1 of the guideline. One service per trainer tier, because the
-- rate lives on the service — a single Gym row could not carry four prices.
INSERT INTO services (
  id, category_id, name, slug, duration_min, base_price, is_active, updated_at
)
SELECT gen_random_uuid(), c.id, v.name, v.slug, 60, v.price, true, now()
FROM (VALUES
  ('Gym – Basic Trainer',    'gym-basic-trainer',     800),
  ('Gym – Standard Trainer', 'gym-standard-trainer',  900),
  ('Gym – Premium Trainer',  'gym-premium-trainer',  1000),
  ('Gym – Elite Trainer',    'gym-elite-trainer',    1100)
) AS v(name, slug, price)
CROSS JOIN (SELECT id FROM service_categories WHERE slug = 'gym') AS c
ON CONFLICT (slug) DO UPDATE
SET name        = EXCLUDED.name,
    category_id = EXCLUDED.category_id,
    base_price  = EXCLUDED.base_price,
    is_active   = true,
    deleted_at  = NULL,
    updated_at  = now();

-- Yoga. The rate is per person per session; a group deal is a package with
-- `persons` above 1, so the service itself knows nothing about head count
-- (client, 18 Nov 2026).
INSERT INTO services (
  id, category_id, name, slug, duration_min, base_price, is_active, updated_at
)
SELECT gen_random_uuid(), c.id, 'Group Yoga', 'group-yoga', 60, 375, true, now()
FROM (SELECT id FROM service_categories WHERE slug = 'yoga') AS c
ON CONFLICT (slug) DO UPDATE
SET category_id = EXCLUDED.category_id,
    base_price  = EXCLUDED.base_price,
    is_active   = true,
    deleted_at  = NULL,
    updated_at  = now();

-- ------------------------------------------------------------------ packages
-- Section 7 of the guideline, reshaped 18 Nov 2026: a package holds a signed
-- percent and its own `persons`, and names the services it is sold on. The
-- rupees come from `services.base_price`: price = base x persons x sessions,
-- then the percent.
--
-- `name` has no unique index (a retired row may keep its name), so the match
-- is made by hand against live rows.
WITH wanted(name, icon, session_count, persons, validity_days, percent_adjust,
            free_session_count, sort_order) AS (
  VALUES
    ('Trial Offer',          '🎁',  1, 1,  7,  20::numeric, 1, 0),
    ('Weekly Fitness',       '⚡',  5, 1,  7,  10::numeric, 0, 1),
    ('Monthly Fitness',      '📅', 12, 1, 30,   5::numeric, 0, 2),
    ('Monthly Intensive',    '🔥', 24, 1, 30,   0::numeric, 0, 3),
    ('90-Day Fitness Plan',  '🏅', 36, 1, 90, -10::numeric, 0, 4),
    ('90-Day Intensive Plan','🏆', 72, 1, 90, -15::numeric, 0, 5),
    ('Monthly Group of 3',   '👪', 24, 3, 30, -20::numeric, 0, 6)
),
updated AS (
  UPDATE packages p
  SET icon               = w.icon,
      session_count      = w.session_count,
      persons            = w.persons,
      validity_days      = w.validity_days,
      percent_adjust     = w.percent_adjust,
      free_session_count = w.free_session_count,
      sort_order         = w.sort_order,
      is_active          = true,
      updated_at         = now()
  FROM wanted w
  WHERE p.name = w.name AND p.deleted_at IS NULL
  RETURNING w.name
)
INSERT INTO packages (
  id, name, icon, session_count, persons, validity_days, percent_adjust,
  free_session_count, allowed_weekdays, fixed_instructor_allowed,
  sort_order, is_active, updated_at
)
SELECT gen_random_uuid(), w.name, w.icon, w.session_count, w.persons,
       w.validity_days, w.percent_adjust, w.free_session_count, '{}'::int[],
       true, w.sort_order, true, now()
FROM wanted w
WHERE w.name NOT IN (SELECT name FROM updated);

-- ------------------------------------------------------- package ↔ service
-- A package with no row here is sold nowhere (client, 18 Nov 2026). The seed
-- offers every package on every seeded service; the admin narrows it per
-- package in the panel.
INSERT INTO package_services (id, package_id, service_id)
SELECT gen_random_uuid(), p.id, s.id
FROM packages p
CROSS JOIN services s
WHERE p.deleted_at IS NULL AND s.deleted_at IS NULL
ON CONFLICT (package_id, service_id) DO NOTHING;

COMMIT;
