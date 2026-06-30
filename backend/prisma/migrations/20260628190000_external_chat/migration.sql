-- AlterTable
ALTER TABLE "User" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'member';
ALTER TABLE "User" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConversationAccessLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactEmail" VARCHAR(320),
    "contactPhone" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "claimedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationAccessLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAccessLink_tokenHash_key" ON "ConversationAccessLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ConversationAccessLink_conversationId_idx" ON "ConversationAccessLink"("conversationId");

-- AddForeignKey
ALTER TABLE "ConversationAccessLink" ADD CONSTRAINT "ConversationAccessLink_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
