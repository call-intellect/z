-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "visibilityScope" VARCHAR(16) NOT NULL DEFAULT 'participants';

-- CreateTable
CREATE TABLE "MeetingAccessGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "granteeType" VARCHAR(8) NOT NULL,
    "granteeId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingAccessGrant_tenantId_meetingId_idx" ON "MeetingAccessGrant"("tenantId", "meetingId");

-- CreateIndex
CREATE INDEX "MeetingAccessGrant_granteeType_granteeId_idx" ON "MeetingAccessGrant"("granteeType", "granteeId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAccessGrant_meetingId_granteeType_granteeId_key" ON "MeetingAccessGrant"("meetingId", "granteeType", "granteeId");

-- AddForeignKey
ALTER TABLE "MeetingAccessGrant" ADD CONSTRAINT "MeetingAccessGrant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
