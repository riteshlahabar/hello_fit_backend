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
-- Solo, so packages apply and the head count stays at one.
INSERT INTO services (
  id, category_id, name, slug, duration_min, base_price, level,
  allow_multi_person, max_participants, is_home_service, is_active, updated_at
)
SELECT gen_random_uuid(), c.id, v.name, v.slug, 60, v.price, 'ALL_LEVELS',
       false, 1, true, true, now()
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

-- Yoga: the group sheet. Rs 9,000 per person, priced by the slabs below, so
-- packages are hidden for this one — the two systems never both apply.
INSERT INTO services (
  id, category_id, name, slug, duration_min, base_price, level,
  allow_multi_person, max_participants, is_home_service, is_active, updated_at
)
SELECT gen_random_uuid(), c.id, 'Group Yoga', 'group-yoga', 60, 9000,
       'ALL_LEVELS', true, 10, true, true, now()
FROM (SELECT id FROM service_categories WHERE slug = 'yoga') AS c
ON CONFLICT (slug) DO UPDATE
SET category_id        = EXCLUDED.category_id,
    base_price         = EXCLUDED.base_price,
    allow_multi_person = true,
    max_participants   = EXCLUDED.max_participants,
    is_active          = true,
    deleted_at         = NULL,
    updated_at         = now();

-- ------------------------------------------------------------------ packages
-- Section 7 of the guideline. A package holds a signed percent, never a price:
-- the rupees come from whichever service is booked. Positive is the markup on
-- the short packages, negative the 90-day discount.
--
-- `name` has no unique index (a retired row may keep its name), so the match
-- is made by hand against live rows.
WITH wanted(name, icon, session_count, validity_days, percent_adjust,
            free_session_count, sort_order) AS (
  VALUES
    ('Trial Offer',          '🎁',  1,  7,  20::numeric, 1, 0),
    ('Weekly Fitness',       '⚡',  5,  7,  10::numeric, 0, 1),
    ('Monthly Fitness',      '📅', 12, 30,   5::numeric, 0, 2),
    ('Monthly Intensive',    '🔥', 24, 30,   0::numeric, 0, 3),
    ('90-Day Fitness Plan',  '🏅', 36, 90, -10::numeric, 0, 4),
    ('90-Day Intensive Plan','🏆', 72, 90, -15::numeric, 0, 5)
),
updated AS (
  UPDATE packages p
  SET icon               = w.icon,
      session_count      = w.session_count,
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
  id, name, icon, session_count, validity_days, percent_adjust,
  free_session_count, allowed_weekdays, fixed_instructor_allowed,
  sort_order, is_active, updated_at
)
SELECT gen_random_uuid(), w.name, w.icon, w.session_count, w.validity_days,
       w.percent_adjust, w.free_session_count, '{}'::int[], true,
       w.sort_order, true, now()
FROM wanted w
WHERE w.name NOT IN (SELECT name FROM updated);

-- --------------------------------------------------------------- group slabs
-- The yoga sheet: 3 people -20%, 5 people -30%, 10 people -50%. One person has
-- no row — a size below every slab pays the plain rate, which is the sheet's
-- 0% line. A size between slabs falls to the next lower one.
INSERT INTO group_slabs (id, min_persons, percent_off, is_active, updated_at)
VALUES
  (gen_random_uuid(),  3, 20, true, now()),
  (gen_random_uuid(),  5, 30, true, now()),
  (gen_random_uuid(), 10, 50, true, now())
ON CONFLICT (min_persons) DO UPDATE
SET percent_off = EXCLUDED.percent_off,
    is_active   = true,
    deleted_at  = NULL,
    updated_at  = now();

COMMIT;
