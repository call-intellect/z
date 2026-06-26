-- Перенос данных Task→Issue выполнен pre-migrate шагом (scripts/migrate-task-to-issue.ts) ДО этой миграции.
DELETE FROM "TaskSource" WHERE "issueId" IS NULL;

ALTER TABLE "TaskSource" DROP COLUMN "taskId" CASCADE;

DROP TABLE "Task" CASCADE;

DROP TYPE "TaskStatus";
