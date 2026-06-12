-- CreateTable
CREATE TABLE "SupportCuratorAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "targetBlockId" TEXT,
    "debateDecision" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportCuratorAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportCuratorAction_tenantId_runDate_idx" ON "SupportCuratorAction"("tenantId", "runDate");

-- CreateIndex
CREATE INDEX "SupportCuratorAction_tenantId_blockId_idx" ON "SupportCuratorAction"("tenantId", "blockId");

