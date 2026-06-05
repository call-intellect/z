import { ChatboxSyncMode } from '@prisma/client';
import { z } from 'zod';

/**
 * DTO модуля ChatBox-интеграции (ТЗ 2026-06-05, Фаза 2).
 *
 * Контракт: токен НИКОГДА не возвращается plain — в read-ответе только
 * `hasToken: boolean`. Запросы — Zod-валидация через ZodValidationPipe.
 */

const SyncModeSchema = z.nativeEnum(ChatboxSyncMode);

/** Тело `POST /chatbox/integration/workspaces` — пробный список воркспейсов. */
export const ChatboxWorkspacesProbeSchema = z.object({
  token: z.string().trim().min(10),
});
export type ChatboxWorkspacesProbeDto = z.infer<
  typeof ChatboxWorkspacesProbeSchema
>;

/**
 * Тело `PUT /chatbox/integration` — создать/обновить интеграцию.
 * `token` опционален при update — если не передан, переиспользуем
 * сохранённый ранее `tokenEnc`.
 */
export const ChatboxIntegrationUpsertSchema = z.object({
  token: z.string().trim().min(10).optional(),
  workspaceId: z.string().trim().min(1),
  syncMode: SyncModeSchema,
});
export type ChatboxIntegrationUpsertDto = z.infer<
  typeof ChatboxIntegrationUpsertSchema
>;

/** Один воркспейс в ответе пробы (без чужих секретов). */
export interface ChatboxWorkspaceDto {
  id: string;
  name: string;
  description: string | null;
  role: string;
}

/**
 * Сериализованная интеграция для UI. БЕЗ `tokenEnc` и plain-токена —
 * только `hasToken`.
 */
export interface ChatboxIntegrationResponseDto {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  syncMode: ChatboxSyncMode;
  status: string;
  lastError: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
}
