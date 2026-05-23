/**
 * SBA β-7 — API-клиент для /api/v1/brand-voice.
 *
 * Слой ApiDto (frontend-rules): сырые ответы backend'а как есть.
 */

import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';

export interface BrandVoiceToneApi {
  formal?: number;
  technical?: number;
  casual?: number;
  energetic?: number;
  authoritative?: number;
  friendly?: number;
  playful?: number;
  minimalist?: number;
  expressive?: number;
  inclusive?: number;
}

export interface BrandVoiceValueApi {
  value: string;
  weight: number;
  exampleBlockIds: string[];
}

export interface BrandVoiceTabooApi {
  phrase: string;
  alternative?: string;
  reason: string;
}

export interface BrandVoiceProfileApi {
  id: string;
  tenantId: string;
  tone: BrandVoiceToneApi | null;
  values: BrandVoiceValueApi[] | null;
  taboos: BrandVoiceTabooApi[] | null;
  exampleArtifactIds: string[];
  version: number;
  lastBuiltAt: string | null;
  builderAgentVersion: string | null;
  completeness: number;
  corpusSize: number;
  belowCorpusThreshold: boolean;
  minCorpusSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateBrandVoiceProfileRequest {
  tone?: BrandVoiceToneApi | null;
  values?: BrandVoiceValueApi[] | null;
  taboos?: BrandVoiceTabooApi[] | null;
  exampleArtifactIds?: string[];
}

export interface RebuildBrandVoiceResponseApi {
  ok: true;
  enqueued: boolean;
  reason: string;
}

export interface BrandVoiceArtifactApi {
  id: string;
  name: string;
  mimeType: string;
  status: string;
  useCases: string[];
  createdAt: string;
}

export const brandVoiceApi = {
  get: (orgId: string) =>
    apiClient.get<BrandVoiceProfileApi>('/api/v1/brand-voice', {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, body: UpdateBrandVoiceProfileRequest) =>
    apiClient.patch<BrandVoiceProfileApi>('/api/v1/brand-voice', body, {
      headers: orgHeaders(orgId),
    }),

  rebuild: (orgId: string) =>
    apiClient.post<RebuildBrandVoiceResponseApi>(
      '/api/v1/brand-voice/rebuild',
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  artifacts: (orgId: string) =>
    apiClient.get<{ items: BrandVoiceArtifactApi[] }>(
      '/api/v1/brand-voice/artifacts',
      {
        headers: orgHeaders(orgId),
      },
    ),

  patchDocumentUseCases: (
    orgId: string,
    documentId: string,
    useCases: string[],
  ) =>
    apiClient.patch<{ id: string; useCases: string[]; updatedAt: string }>(
      `/api/v1/documents/${documentId}/use-cases`,
      { useCases },
      { headers: orgHeaders(orgId) },
    ),
};
