-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('dm', 'group', 'channel', 'work_chat', 'external', 'ticket');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "ConversationKind" NOT NULL,
    "title" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "feedsGraph" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMember" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "lastReadSeq" BIGINT NOT NULL DEFAULT 0,
    "mutedUntil" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL DEFAULT 'human',
    "access" TEXT NOT NULL DEFAULT 'normal',
    "content" TEXT NOT NULL,
    "contentHtml" TEXT,
    "contentStripped" TEXT,
    "parentMessageId" TEXT,
    "clientMessageId" TEXT NOT NULL,
    "voiceUrl" TEXT,
    "voiceDuration" INTEGER,
    "voiceTranscript" TEXT,
    "attachments" JSONB,
    "mentions" TEXT[],
    "reactions" JSONB,
    "thanksUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "draftState" TEXT,
    "cloneConfidence" DECIMAL(4,3),
    "groundednessScore" DECIMAL(4,3),
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageOutbox" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_tenantId_kind_lastMessageAt_idx" ON "Conversation"("tenantId", "kind", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMember_conversationId_userId_key" ON "ConversationMember"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "ConversationMember_userId_idx" ON "ConversationMember"("userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_seq_idx" ON "Message"("conversationId", "seq");

-- CreateIndex
CREATE INDEX "Message_tenantId_createdAt_idx" ON "Message"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_clientMessageId_key" ON "Message"("conversationId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_seq_key" ON "Message"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "MessageOutbox_messageId_key" ON "MessageOutbox"("messageId");

-- CreateIndex
CREATE INDEX "MessageOutbox_status_createdAt_idx" ON "MessageOutbox"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
