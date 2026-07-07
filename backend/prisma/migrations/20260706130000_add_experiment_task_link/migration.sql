SET search_path TO "public";

-- CreateTable
CREATE TABLE "experiment_task_link" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "linkType" VARCHAR(24) NOT NULL DEFAULT 'derived',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_task_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "experiment_task_link_experimentId_issueId_key" ON "experiment_task_link"("experimentId", "issueId");

-- CreateIndex
CREATE INDEX "experiment_task_link_issueId_idx" ON "experiment_task_link"("issueId");

-- AddForeignKey
ALTER TABLE "experiment_task_link" ADD CONSTRAINT "experiment_task_link_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_task_link" ADD CONSTRAINT "experiment_task_link_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
