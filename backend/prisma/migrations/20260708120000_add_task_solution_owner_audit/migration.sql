SET search_path TO public;

-- B2: аудит расхождения владельца (assignee vs решатель) при выводе владельца из текста.
ALTER TABLE "task_solutions" ADD COLUMN "ownerAudit" JSONB;
