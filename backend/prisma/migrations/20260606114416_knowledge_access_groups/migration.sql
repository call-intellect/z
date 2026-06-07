-- CreateEnum
CREATE TYPE "KnowledgeGroupKind" AS ENUM ('department', 'leadership', 'council', 'personal');

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "closedGroupKind" VARCHAR(20);

-- AlterTable
ALTER TABLE "MeetingTypeConfig" ADD COLUMN     "defaultClosedGroupKind" VARCHAR(20);

-- CreateTable
CREATE TABLE "KnowledgeGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "KnowledgeGroupKind" NOT NULL,
    "refId" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGroupMember" (
    "groupId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGroupMember_pkey" PRIMARY KEY ("groupId","personId")
);

-- CreateTable
CREATE TABLE "IdeaBlockAccess" (
    "blockId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "via" VARCHAR(12) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaBlockAccess_pkey" PRIMARY KEY ("blockId","groupId")
);

-- CreateTable
CREATE TABLE "GroupVisibilityPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subjectGroupId" TEXT NOT NULL,
    "visibleGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupVisibilityPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeGroup_tenantId_kind_idx" ON "KnowledgeGroup"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGroup_tenantId_kind_refId_key" ON "KnowledgeGroup"("tenantId", "kind", "refId");

-- CreateIndex
CREATE INDEX "KnowledgeGroupMember_personId_idx" ON "KnowledgeGroupMember"("personId");

-- CreateIndex
CREATE INDEX "IdeaBlockAccess_groupId_idx" ON "IdeaBlockAccess"("groupId");

-- CreateIndex
CREATE INDEX "GroupVisibilityPolicy_tenantId_subjectGroupId_idx" ON "GroupVisibilityPolicy"("tenantId", "subjectGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupVisibilityPolicy_subjectGroupId_visibleGroupId_key" ON "GroupVisibilityPolicy"("subjectGroupId", "visibleGroupId");

-- AddForeignKey
ALTER TABLE "KnowledgeGroup" ADD CONSTRAINT "KnowledgeGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeGroupMember" ADD CONSTRAINT "KnowledgeGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "KnowledgeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockAccess" ADD CONSTRAINT "IdeaBlockAccess_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "IdeaBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockAccess" ADD CONSTRAINT "IdeaBlockAccess_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "KnowledgeGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupVisibilityPolicy" ADD CONSTRAINT "GroupVisibilityPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
