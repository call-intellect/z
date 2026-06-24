SET search_path = public;

-- AlterTable
ALTER TABLE "ChatboxChat" ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false;
