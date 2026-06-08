-- TZ-1 Фаза 3.B (daily-value-engine) — join Decision↔Issue.
-- Прямой связи Decision→Issue в схеме нет; вводим явную join-таблицу вместо
-- плодёжа массивов. Аддитивно (CREATE TABLE + INDEX + FK), без потери данных.
-- FK на "decisions"(id) и "Issue"(id) — onDelete: CASCADE (link исчезает с
-- удалением любой из сторон). См.
-- plans/tz/2026-06-08-agents-daily-value-engine.md (Ф3.B).

-- CreateTable
CREATE TABLE "decision_task_link" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "linkType" VARCHAR(24) NOT NULL DEFAULT 'implements',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_task_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "decision_task_link_decisionId_issueId_key" ON "decision_task_link"("decisionId", "issueId");

-- CreateIndex
CREATE INDEX "decision_task_link_issueId_idx" ON "decision_task_link"("issueId");

-- AddForeignKey
ALTER TABLE "decision_task_link" ADD CONSTRAINT "decision_task_link_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_task_link" ADD CONSTRAINT "decision_task_link_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
