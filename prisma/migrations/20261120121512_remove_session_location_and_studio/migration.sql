-- Session location removed (client, 20-11-2026).
--
-- HelloFit is home-service only: every trainer travels to the customer, so
-- "where will the session be held" has one answer and needs no column. This
-- overrides the PDF's §5.5 "Session location" search filter, the way the
-- 17-11-2026 pricing instruction overrode §4.5.
--
-- `studio_name` / `studio_address` go with it: they only ever meant anything
-- for PROVIDER_LOCATION, a trainer's own studio, which no longer exists as a
-- case.

ALTER TABLE "instructor_profiles" DROP COLUMN "session_formats";
ALTER TABLE "instructor_profiles" DROP COLUMN "studio_name";
ALTER TABLE "instructor_profiles" DROP COLUMN "studio_address";

DROP TYPE "SessionFormat";
