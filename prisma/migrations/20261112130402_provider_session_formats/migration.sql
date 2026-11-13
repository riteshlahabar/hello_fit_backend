-- CreateEnum
CREATE TYPE "SessionFormat" AS ENUM ('CUSTOMER_HOME', 'PROVIDER_LOCATION', 'ONLINE');

-- AlterTable
ALTER TABLE "instructor_profiles" ADD COLUMN     "session_formats" "SessionFormat"[] DEFAULT ARRAY['CUSTOMER_HOME']::"SessionFormat"[];
