-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('CUSTOMER', 'INSTRUCTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "event_key" VARCHAR(80) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "title" VARCHAR(200),
    "body" TEXT NOT NULL,
    "deep_link" TEXT,
    "provider_ref" VARCHAR(120),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "event_key" VARCHAR(80) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "user_id" UUID,
    "template_id" UUID,
    "title" VARCHAR(200),
    "body" TEXT NOT NULL,
    "deep_link" TEXT,
    "data" JSONB,
    "destination" VARCHAR(255),
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "provider_message_id" VARCHAR(200),
    "last_error" TEXT,
    "suppressed_reason" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "in_app_notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_key" VARCHAR(80) NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "deep_link" TEXT,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "event_key" VARCHAR(80),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_templates_event_key_idx" ON "notification_templates"("event_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_key_channel_audience_locale_key" ON "notification_templates"("event_key", "channel", "audience", "locale");

-- CreateIndex
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "notification_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_outbox_user_id_created_at_idx" ON "notification_outbox"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_outbox_event_key_idx" ON "notification_outbox"("event_key");

-- CreateIndex
CREATE INDEX "in_app_notifications_user_id_read_at_idx" ON "in_app_notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "in_app_notifications_user_id_created_at_idx" ON "in_app_notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_channel_event_key_key" ON "notification_preferences"("user_id", "channel", "event_key");

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "in_app_notifications" ADD CONSTRAINT "in_app_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
