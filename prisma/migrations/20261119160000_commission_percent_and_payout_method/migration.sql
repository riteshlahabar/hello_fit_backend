-- Client decisions of 19 Nov 2026, points 4, 5, 6 and 11.
--
-- 1. TrainerCategory goes completely: the band carried no price, only a
--    commission, and commission now lives on the service with a per-provider
--    override. Nothing else referenced it.
-- 2. Service.commission_pct is compulsory. Existing rows are backfilled from
--    the active GLOBAL commission rule, falling back to the settings default
--    of 25 - so no service silently changes what a trainer earns.
-- 3. instructor_bank_accounts becomes a radio: UPI or bank, never both, so the
--    bank columns must be nullable. The DTO makes the chosen side compulsory.

-- ---------------------------------------------------------------- 1. drop band

ALTER TABLE "instructor_profiles" DROP CONSTRAINT IF EXISTS "instructor_profiles_trainer_category_id_fkey";
ALTER TABLE "commission_rules"    DROP CONSTRAINT IF EXISTS "commission_rules_trainer_category_id_fkey";

-- A rule scoped to a band is meaningless without the band.
DELETE FROM "commission_rules" WHERE "scope" = 'TRAINER_CATEGORY';

ALTER TABLE "instructor_profiles" DROP COLUMN "trainer_category_id";
ALTER TABLE "commission_rules"    DROP COLUMN "trainer_category_id";

DROP TABLE "trainer_categories";

-- Postgres cannot drop one label from an enum in place.
ALTER TYPE "CommissionScope" RENAME TO "CommissionScope_old";
CREATE TYPE "CommissionScope" AS ENUM ('GLOBAL', 'CATEGORY', 'SERVICE', 'INSTRUCTOR');
ALTER TABLE "commission_rules"
  ALTER COLUMN "scope" TYPE "CommissionScope" USING ("scope"::text::"CommissionScope");
DROP TYPE "CommissionScope_old";

-- ---------------------------------------------- 2. commission on the service

ALTER TABLE "services" ADD COLUMN "commission_pct" DECIMAL(5,2);

UPDATE "services" SET "commission_pct" = COALESCE(
  (SELECT "value" FROM "commission_rules"
    WHERE "scope" = 'GLOBAL' AND "is_active" = true AND "deleted_at" IS NULL
    ORDER BY "effective_from" DESC LIMIT 1),
  25
);

ALTER TABLE "services" ALTER COLUMN "commission_pct" SET NOT NULL;

-- Optional per-provider override. Null means the service percent applies.
ALTER TABLE "instructor_profiles" ADD COLUMN "commission_pct" DECIMAL(5,2);

-- ------------------------------------------------------- 3. payout is a radio

CREATE TYPE "PayoutMethod" AS ENUM ('UPI', 'BANK');

ALTER TABLE "instructor_bank_accounts"
  ADD COLUMN "payout_method" "PayoutMethod" NOT NULL DEFAULT 'BANK';

ALTER TABLE "instructor_bank_accounts" ALTER COLUMN "holder_name"    DROP NOT NULL;
ALTER TABLE "instructor_bank_accounts" ALTER COLUMN "bank_name"      DROP NOT NULL;
ALTER TABLE "instructor_bank_accounts" ALTER COLUMN "account_number" DROP NOT NULL;
ALTER TABLE "instructor_bank_accounts" ALTER COLUMN "ifsc"           DROP NOT NULL;
ALTER TABLE "instructor_bank_accounts" ALTER COLUMN "account_type"   DROP NOT NULL;
ALTER TABLE "instructor_bank_accounts" ALTER COLUMN "account_type"   DROP DEFAULT;
