-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "persons" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "services" DROP COLUMN "allow_multi_person",
DROP COLUMN "inclusions",
DROP COLUMN "is_home_service",
DROP COLUMN "level",
DROP COLUMN "max_participants";

-- DropTable
DROP TABLE "group_slabs";

-- CreateTable
CREATE TABLE "package_services" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_services_service_id_idx" ON "package_services"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "package_services_package_id_service_id_key" ON "package_services"("package_id", "service_id");

-- AddForeignKey
ALTER TABLE "package_services" ADD CONSTRAINT "package_services_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_services" ADD CONSTRAINT "package_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

