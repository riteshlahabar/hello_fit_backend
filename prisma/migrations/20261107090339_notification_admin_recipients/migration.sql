-- AlterTable
ALTER TABLE "in_app_notifications" ADD COLUMN     "admin_user_id" UUID,
ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "notification_outbox" ADD COLUMN     "admin_user_id" UUID;

-- CreateIndex
CREATE INDEX "in_app_notifications_admin_user_id_read_at_idx" ON "in_app_notifications"("admin_user_id", "read_at");

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
