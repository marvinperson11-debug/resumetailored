-- Additive migration: add JobApplication.sourceQueueId (apply-queue sync)
-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN IF NOT EXISTS "sourceQueueId" TEXT;
