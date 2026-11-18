-- Drop the dead MEMBERSHIP booking type.
--
-- Membership plans were deleted on 17 Nov 2026 (client: the word "plan" means
-- "package"), and the plan module, the MembershipPlan table and the
-- BookingSource.MEMBERSHIP value went with them. This enum value was the last
-- survivor: nothing writes it and no row carries it.
--
-- Postgres cannot drop a value from an enum, so the type is rebuilt. The
-- default has to come off the column first or the cast fails on it.

ALTER TYPE "BookingType" RENAME TO "BookingType_old";

CREATE TYPE "BookingType" AS ENUM ('SINGLE', 'PACKAGE');

ALTER TABLE "bookings" ALTER COLUMN "type" DROP DEFAULT;

ALTER TABLE "bookings"
  ALTER COLUMN "type" TYPE "BookingType"
  USING ("type"::text::"BookingType");

ALTER TABLE "bookings" ALTER COLUMN "type" SET DEFAULT 'SINGLE';

DROP TYPE "BookingType_old";
