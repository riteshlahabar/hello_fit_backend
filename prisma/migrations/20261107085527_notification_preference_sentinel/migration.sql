/*
  Warnings:

  - Made the column `event_key` on table `notification_preferences` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "notification_preferences" ALTER COLUMN "event_key" SET NOT NULL,
ALTER COLUMN "event_key" SET DEFAULT '*';
