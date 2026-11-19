-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('SAVINGS', 'CURRENT');

-- AlterTable
ALTER TABLE "instructor_profiles" ADD COLUMN     "address_line" TEXT,
ADD COLUMN     "city" VARCHAR(120),
ADD COLUMN     "clients_trained_band" VARCHAR(20),
ADD COLUMN     "country" VARCHAR(120) DEFAULT 'India',
ADD COLUMN     "institute" VARCHAR(160),
ADD COLUMN     "landmark" VARCHAR(160),
ADD COLUMN     "pincode" VARCHAR(6),
ADD COLUMN     "qualification" VARCHAR(160),
ADD COLUMN     "state" VARCHAR(120),
ADD COLUMN     "studio_address" TEXT,
ADD COLUMN     "studio_name" VARCHAR(160);

-- CreateTable
CREATE TABLE "instructor_bank_accounts" (
    "id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "holder_name" VARCHAR(160) NOT NULL,
    "bank_name" VARCHAR(160) NOT NULL,
    "account_number" VARCHAR(34) NOT NULL,
    "ifsc" VARCHAR(11) NOT NULL,
    "account_type" "BankAccountType" NOT NULL DEFAULT 'SAVINGS',
    "upi_id" VARCHAR(120),
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instructor_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instructor_bank_accounts_instructor_id_key" ON "instructor_bank_accounts"("instructor_id");

-- AddForeignKey
ALTER TABLE "instructor_bank_accounts" ADD CONSTRAINT "instructor_bank_accounts_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "instructor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
