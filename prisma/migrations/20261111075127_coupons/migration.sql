-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FLAT');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "coupon_id" UUID;

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(200),
    "discount_type" "DiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "max_discount" DECIMAL(10,2),
    "min_booking_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE NOT NULL,
    "usage_limit" INTEGER,
    "per_customer_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_is_active_idx" ON "coupons"("is_active");

-- CreateIndex
CREATE INDEX "coupons_valid_from_valid_to_idx" ON "coupons"("valid_from", "valid_to");

-- CreateIndex
CREATE INDEX "bookings_coupon_id_idx" ON "bookings"("coupon_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
