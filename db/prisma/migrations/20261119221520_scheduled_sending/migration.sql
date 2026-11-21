-- AlterEnum
ALTER TYPE "ScheduledSendStatus" ADD VALUE 'SENDING';

-- DropForeignKey
ALTER TABLE "ScheduledSend" DROP CONSTRAINT "ScheduledSend_messageId_fkey";

-- AlterTable
ALTER TABLE "ScheduledSend" ALTER COLUMN "messageId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ScheduledSend" ADD CONSTRAINT "ScheduledSend_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
