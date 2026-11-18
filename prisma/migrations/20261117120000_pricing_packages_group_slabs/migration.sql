-- AlterEnum
ALTER TYPE "CommissionScope" ADD VALUE 'TRAINER_CATEGORY';

-- DropForeignKey
ALTER TABLE "customer_profiles" DROP CONSTRAINT "customer_profiles_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "packages" DROP CONSTRAINT "packages_service_id_fkey";

-- DropForeignKey
ALTER TABLE "plan_features" DROP CONSTRAINT "plan_features_plan_id_fkey";

-- DropIndex
DROP INDEX "packages_service_id_is_active_idx";

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "participant_count" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "commission_rules" ADD COLUMN     "trainer_category_id" UUID;

-- AlterTable
ALTER TABLE "customer_profiles" DROP COLUMN "plan_id";

-- AlterTable
ALTER TABLE "instructor_profiles" ADD COLUMN     "trainer_category_id" UUID;

-- AlterTable
ALTER TABLE "instructor_services" DROP COLUMN "custom_price";

-- AlterTable
ALTER TABLE "packages" DROP COLUMN "price",
DROP COLUMN "service_id",
ADD COLUMN     "free_session_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "percent_adjust" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "allow_multi_person" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "plan_features";

-- DropTable
DROP TABLE "plans";

-- CreateTable
CREATE TABLE "group_slabs" (
    "id" UUID NOT NULL,
    "min_persons" INTEGER NOT NULL,
    "percent_off" DECIMAL(5,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "group_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "trainer_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_slabs_min_persons_key" ON "group_slabs"("min_persons");

-- CreateIndex
CREATE INDEX "group_slabs_is_active_min_persons_idx" ON "group_slabs"("is_active", "min_persons");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_categories_name_key" ON "trainer_categories"("name");

-- CreateIndex
CREATE INDEX "trainer_categories_is_active_sort_order_idx" ON "trainer_categories"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "packages_is_active_sort_order_idx" ON "packages"("is_active", "sort_order");

-- AddForeignKey
ALTER TABLE "instructor_profiles" ADD CONSTRAINT "instructor_profiles_trainer_category_id_fkey" FOREIGN KEY ("trainer_category_id") REFERENCES "trainer_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_trainer_category_id_fkey" FOREIGN KEY ("trainer_category_id") REFERENCES "trainer_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
