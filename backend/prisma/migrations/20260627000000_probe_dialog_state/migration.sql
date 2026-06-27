-- CreateEnum
CREATE TYPE "ProbeDialogPhase" AS ENUM ('awaiting_answer', 'awaiting_clarification', 'awaiting_confirmation', 'resolved');

-- AlterEnum
ALTER TYPE "ProbeStatus" ADD VALUE 'awaiting_dialog';
ALTER TYPE "ProbeStatus" ADD VALUE 'applied';
ALTER TYPE "ProbeStatus" ADD VALUE 'escalated_to_human';
ALTER TYPE "ProbeStatus" ADD VALUE 'abandoned';

-- CreateTable
CREATE TABLE "ProbeDialogState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "probeEventId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "phase" "ProbeDialogPhase" NOT NULL DEFAULT 'awaiting_answer',
    "outcome" TEXT,
    "collectedValue" TEXT,
    "confidence" DOUBLE PRECISION,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProbeDialogState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProbeDialogState_probeEventId_key" ON "ProbeDialogState"("probeEventId");

-- CreateIndex
CREATE INDEX "ProbeDialogState_tenantId_probeEventId_idx" ON "ProbeDialogState"("tenantId", "probeEventId");

-- CreateIndex
CREATE INDEX "ProbeDialogState_tenantId_recipientUserId_phase_idx" ON "ProbeDialogState"("tenantId", "recipientUserId", "phase");

-- AddForeignKey
ALTER TABLE "ProbeDialogState" ADD CONSTRAINT "ProbeDialogState_probeEventId_fkey" FOREIGN KEY ("probeEventId") REFERENCES "probe_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
