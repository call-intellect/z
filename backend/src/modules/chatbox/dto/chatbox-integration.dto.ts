import { ChatboxSyncMode } from '@prisma/client';
import { z } from 'zod';

const SyncModeSchema = z.nativeEnum(ChatboxSyncMode);

export const ChatboxWorkspacesProbeSchema = z.object({
  token: z.string().trim().min(10),
});
export type ChatboxWorkspacesProbeDto = z.infer<typeof ChatboxWorkspacesProbeSchema>;

export const ChatboxIntegrationUpsertSchema = z.object({
  token: z.string().trim().min(10).optional(),
  workspaceId: z.string().trim().min(1),
  syncMode: SyncModeSchema,
  analysisEnabled: z.boolean().optional(),
});
export type ChatboxIntegrationUpsertDto = z.infer<typeof ChatboxIntegrationUpsertSchema>;

export const ChatboxSyncRequestSchema = z.object({
  scope: z.enum(['all', 'customers', 'managers', 'chats']),
  since: z.string().datetime().optional(),
});
export type ChatboxSyncRequestDto = z.infer<typeof ChatboxSyncRequestSchema>;

export interface ChatboxWorkspaceDto {
  id: string;
  name: string;
  description: string | null;
  role: string;
}

export interface ChatboxIntegrationResponseDto {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  syncMode: ChatboxSyncMode;
  analysisEnabled: boolean;
  status: string;
  lastError: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
}
