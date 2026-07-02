-- CreateIndex
CREATE INDEX "IdeaBlockEvidence_tenantId_authorPersonId_sourceTimestamp_idx" ON "IdeaBlockEvidence"("tenantId", "authorPersonId", "sourceTimestamp");
