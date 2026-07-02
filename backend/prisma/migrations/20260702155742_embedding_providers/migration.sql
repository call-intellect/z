-- CreateTable
CREATE TABLE "embedding_providers" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "baseUrl" VARCHAR(500) NOT NULL,
    "protocolKind" VARCHAR(40) NOT NULL,
    "apiKeyEncrypted" TEXT,
    "defaultHeaders" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "needsReindex" BOOLEAN NOT NULL DEFAULT false,
    "lastSmokeAt" TIMESTAMP(3),
    "lastSmokeSuccess" BOOLEAN,
    "lastSmokeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "embedding_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_models" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelKey" VARCHAR(120) NOT NULL,
    "displayName" VARCHAR(200) NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "pricePerMillionInputTokensKopecks" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "embedding_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "embedding_providers_name_key" ON "embedding_providers"("name");

-- CreateIndex
CREATE INDEX "embedding_providers_isActive_priority_idx" ON "embedding_providers"("isActive", "priority");

-- CreateIndex
CREATE INDEX "embedding_models_providerId_isActive_idx" ON "embedding_models"("providerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_models_providerId_modelKey_key" ON "embedding_models"("providerId", "modelKey");

-- AddForeignKey
ALTER TABLE "embedding_models" ADD CONSTRAINT "embedding_models_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "embedding_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

