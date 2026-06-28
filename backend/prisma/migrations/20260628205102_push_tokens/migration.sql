ALTER TYPE "ChannelKind" ADD VALUE IF NOT EXISTS 'push';

CREATE TABLE IF NOT EXISTS "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transport" VARCHAR(20) NOT NULL,
    "token" TEXT NOT NULL,
    "deviceInfo" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushToken_userId_transport_token_key" ON "PushToken"("userId", "transport", "token");
CREATE INDEX IF NOT EXISTS "PushToken_tenantId_userId_idx" ON "PushToken"("tenantId", "userId");

ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "UserBlock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "blockerUserId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserBlock_tenantId_blockerUserId_blockedUserId_key" ON "UserBlock"("tenantId", "blockerUserId", "blockedUserId");
CREATE INDEX IF NOT EXISTS "UserBlock_tenantId_blockedUserId_idx" ON "UserBlock"("tenantId", "blockedUserId");

ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerUserId_fkey" FOREIGN KEY ("blockerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "MessageReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MessageReport_tenantId_messageId_idx" ON "MessageReport"("tenantId", "messageId");
CREATE INDEX IF NOT EXISTS "MessageReport_tenantId_conversationId_idx" ON "MessageReport"("tenantId", "conversationId");
