-- CreateTable
CREATE TABLE "PersonLeave" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'vacation',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonLeave_tenantId_personId_fromDate_toDate_idx" ON "PersonLeave"("tenantId", "personId", "fromDate", "toDate");

-- AddForeignKey
ALTER TABLE "PersonLeave" ADD CONSTRAINT "PersonLeave_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
