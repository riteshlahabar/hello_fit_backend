-- CreateTable
CREATE TABLE "favourites" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favourites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favourites_customer_id_created_at_idx" ON "favourites"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "favourites_customer_id_instructor_id_key" ON "favourites"("customer_id", "instructor_id");

-- AddForeignKey
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "instructor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
