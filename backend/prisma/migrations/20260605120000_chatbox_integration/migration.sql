-- CreateEnum
CREATE TYPE "ChatboxSyncMode" AS ENUM ('hourly', 'daily', 'realtime');

-- CreateEnum
CREATE TYPE "ChatboxIntegrationStatus" AS ENUM ('connected', 'error', 'disconnected');

-- CreateEnum
CREATE TYPE "ChatboxChatStatus" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "ChatboxSenderType" AS ENUM ('CLIENT', 'USER', 'ASSISTANT', 'QUALITY_CONTROL');

-- CreateEnum
CREATE TYPE "ChatboxContentType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'VIDEO_NOTE', 'FILE', 'VOICE', 'COMMAND');

-- CreateEnum
CREATE TYPE "ChatboxSessionAnalysisStatus" AS ENUM ('pending', 'analyzing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ChatboxMemberLinkMode" AS ENUM ('auto', 'manual', 'none');

-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'chatbox';

-- CreateTable
CREATE TABLE "ChatboxIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspaceName" TEXT,
    "syncMode" "ChatboxSyncMode" NOT NULL DEFAULT 'daily',
    "status" "ChatboxIntegrationStatus" NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "webhookExternalId" TEXT,
    "webhookSecret" TEXT,
    "lastFullSyncAt" TIMESTAMP(3),
    "lastIncrementalSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatboxIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatboxChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatboxChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatboxCustomer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "externalCrmId" TEXT,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatboxCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatboxChannelClient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "customerExternalId" TEXT,
    "customerId" TEXT,
    "channelType" TEXT NOT NULL,
    "channelExternalId" TEXT,
    "messengerUserId" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "avatarUrl" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatboxChannelClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatboxMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "role" TEXT,
    "linkedPersonId" TEXT,
    "linkMode" "ChatboxMemberLinkMode" NOT NULL DEFAULT 'none',
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatboxMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatboxChat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "channelExternalId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "clientExternalId" TEXT,
    "customerExternalId" TEXT,
    "responsibleExternalId" TEXT,
    "status" "ChatboxChatStatus" NOT NULL DEFAULT 'active',
    "externalCreatedAt" TIMESTAMP(3) NOT NULL,
    "externalUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatboxChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatboxChatSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "previousSessionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "analysisStatus" "ChatboxSessionAnalysisStatus" NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "rawEventId" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatboxChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatboxMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "sessionId" TEXT,
    "externalId" TEXT NOT NULL,
    "senderType" "ChatboxSenderType" NOT NULL,
    "senderExternalId" TEXT,
    "senderName" TEXT,
    "contentType" "ChatboxContentType" NOT NULL DEFAULT 'TEXT',
    "text" TEXT,
    "imageUrl" TEXT,
    "fileUrl" TEXT,
    "audioUrl" TEXT,
    "videoUrl" TEXT,
    "externalCreatedAt" TIMESTAMP(3) NOT NULL,
    "isOutboundFromKora" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatboxIntegration_tenantId_key" ON "ChatboxIntegration"("tenantId");

-- CreateIndex
CREATE INDEX "ChatboxChannel_tenantId_idx" ON "ChatboxChannel"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatboxChannel_tenantId_externalId_key" ON "ChatboxChannel"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "ChatboxCustomer_tenantId_idx" ON "ChatboxCustomer"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatboxCustomer_tenantId_externalId_key" ON "ChatboxCustomer"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "ChatboxChannelClient_tenantId_customerId_idx" ON "ChatboxChannelClient"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatboxChannelClient_tenantId_externalId_key" ON "ChatboxChannelClient"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "ChatboxMember_tenantId_linkedPersonId_idx" ON "ChatboxMember"("tenantId", "linkedPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatboxMember_tenantId_externalId_key" ON "ChatboxMember"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "ChatboxChat_tenantId_customerExternalId_idx" ON "ChatboxChat"("tenantId", "customerExternalId");

-- CreateIndex
CREATE INDEX "ChatboxChat_tenantId_lastMessageAt_idx" ON "ChatboxChat"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatboxChat_tenantId_status_idx" ON "ChatboxChat"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChatboxChat_tenantId_externalId_key" ON "ChatboxChat"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "ChatboxChatSession_tenantId_analysisStatus_idx" ON "ChatboxChatSession"("tenantId", "analysisStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ChatboxChatSession_tenantId_chatId_seq_key" ON "ChatboxChatSession"("tenantId", "chatId", "seq");

-- CreateIndex
CREATE INDEX "ChatboxMessage_tenantId_chatId_externalCreatedAt_idx" ON "ChatboxMessage"("tenantId", "chatId", "externalCreatedAt");

-- CreateIndex
CREATE INDEX "ChatboxMessage_tenantId_sessionId_idx" ON "ChatboxMessage"("tenantId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatboxMessage_tenantId_externalId_key" ON "ChatboxMessage"("tenantId", "externalId");

-- AddForeignKey
ALTER TABLE "ChatboxIntegration" ADD CONSTRAINT "ChatboxIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxChannel" ADD CONSTRAINT "ChatboxChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxCustomer" ADD CONSTRAINT "ChatboxCustomer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxChannelClient" ADD CONSTRAINT "ChatboxChannelClient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxChannelClient" ADD CONSTRAINT "ChatboxChannelClient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "ChatboxCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxMember" ADD CONSTRAINT "ChatboxMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxChat" ADD CONSTRAINT "ChatboxChat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxChatSession" ADD CONSTRAINT "ChatboxChatSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxChatSession" ADD CONSTRAINT "ChatboxChatSession_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ChatboxChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxMessage" ADD CONSTRAINT "ChatboxMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatboxMessage" ADD CONSTRAINT "ChatboxMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ChatboxChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

