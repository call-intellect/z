'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import {
  documentsApi,
  type DocumentDetailApi,
  type DocumentEntityKindApi,
  type DocumentStatusApi,
} from '@/api/documents.api';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { TrustBadge } from '@/ui/components/shared/TrustBadge';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from '@app/(admin)/admin/AdminStateViews';

const STATUS_LABELS: Record<DocumentStatusApi, string> = {
  uploaded: 'загружен',
  parsing: 'обрабатывается',
  parsed: 'готов',
  failed: 'ошибка',
};

const ENTITY_GROUP_LABELS: Record<DocumentEntityKindApi, string> = {
  process: 'Процессы',
  decision: 'Решения',
  regulation: 'Регламенты',
  policy: 'Политики',
  metric: 'Метрики',
  tool: 'Инструменты',
};

/**
 * Метку доверия (Фаза C1) показываем только у критических карточек —
 * process / decision / regulation / policy. metric / tool не версионируются.
 */
const TRUST_TIER_KINDS = new Set<DocumentEntityKindApi>([
  'process',
  'decision',
  'regulation',
  'policy',
]);

export function DocumentDetailClient({
  documentId,
}: {
  documentId: string;
}) {
  const { currentOrgId, currentOrgRole, isLoading } = useAuth();
  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках Org."
      />
    );
  }
  const canSeeEntities =
    currentOrgRole === 'owner' || currentOrgRole === 'admin';
  return (
    <Content
      orgId={currentOrgId}
      documentId={documentId}
      canSeeEntities={canSeeEntities}
    />
  );
}

function Content({
  orgId,
  documentId,
  canSeeEntities,
}: {
  orgId: string;
  documentId: string;
  canSeeEntities: boolean;
}) {
  const swr = useSWR(
    ['document-detail', orgId, documentId],
    () => documentsApi.byId(orgId, documentId),
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) => {
        const s = latest?.document.status;
        return s === 'uploaded' || s === 'parsing' ? 2000 : 0;
      },
    },
  );

  if (swr.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (swr.error) {
    if (swr.error instanceof ApiError && swr.error.code === 'http_404') {
      return (
        <div className="mx-auto w-full max-w-4xl px-6 py-8">
          <AdminEmpty
            title="Документ не найден"
            description="Возможно, он был удалён или API ещё не подключён."
          />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminError
          message={swr.error instanceof Error ? swr.error.message : 'Ошибка'}
          onRetry={() => void swr.mutate()}
        />
      </div>
    );
  }
  if (!swr.data) return null;
  return <Detail data={swr.data} canSeeEntities={canSeeEntities} />;
}

function Detail({
  data,
  canSeeEntities,
}: {
  data: DocumentDetailApi;
  canSeeEntities: boolean;
}) {
  const { document, parsedText, ideaBlocks, entityGroups } = data;
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <Link
        href="/documents"
        className="mb-3 inline-flex items-center gap-1 text-xs text-fg-tertiary hover:text-fg-secondary"
      >
        <ArrowLeft size={12} /> К списку
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          {document.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-fg-secondary">
          <Badge variant="secondary" className="text-[10px]">
            {STATUS_LABELS[document.status]}
          </Badge>
          {document.attachedRoleId && (
            <Link
              href={`/roles/${encodeURIComponent(document.attachedRoleId)}`}
              className="text-fg-tertiary hover:text-accent"
            >
              {document.attachedRoleName ?? 'должность'}
            </Link>
          )}
          {document.uploaderName && (
            <span className="text-fg-tertiary">
              Загрузил: {document.uploaderName}
            </span>
          )}
          {typeof document.sizeBytes === 'number' && (
            <span className="text-fg-tertiary">
              {formatBytes(document.sizeBytes)}
            </span>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Распознанный текст</CardTitle>
          </CardHeader>
          <CardContent>
            {document.status === 'failed' ? (
              <p className="text-sm text-danger">
                Ошибка парсинга. Проверьте файл и попробуйте загрузить ещё раз.
              </p>
            ) : document.status === 'parsed' && parsedText ? (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
                {parsedText}
              </pre>
            ) : (
              <div className="flex items-center gap-2 text-sm text-fg-tertiary">
                <Loader2 size={14} className="animate-spin" />
                Парсим файл. Обычно занимает 1–3 минуты.
              </div>
            )}
          </CardContent>
        </Card>

        <div>
          <Tabs defaultValue="ideas">
            <TabsList>
              <TabsTrigger value="ideas">Блоки идей</TabsTrigger>
              {canSeeEntities && (
                <TabsTrigger value="entities">
                  Извлечённые сущности
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="ideas">
              <Card>
                <CardContent className="p-4">
                  {ideaBlocks.length === 0 ? (
                    <p className="text-sm text-fg-tertiary">
                      Блоки появятся после парсинга.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {ideaBlocks.map((b) => (
                        <li key={b.id}>
                          <div className="text-sm font-medium text-fg-primary">
                            {b.title}
                          </div>
                          {b.excerpt && (
                            <p className="mt-1 line-clamp-3 text-xs text-fg-secondary">
                              {b.excerpt}
                            </p>
                          )}
                          {typeof b.confidence === 'number' && (
                            <p className="mt-1 text-[10px] text-fg-tertiary">
                              уверенность {Math.round(b.confidence * 100)}%
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {canSeeEntities && (
              <TabsContent value="entities">
                <Card>
                  <CardContent className="p-4">
                    {entityGroups.length === 0 ? (
                      <p className="text-sm text-fg-tertiary">
                        Сущности появятся после разбора и разметки Корой.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {entityGroups.map((g) => (
                          <div key={g.kind}>
                            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
                              {ENTITY_GROUP_LABELS[g.kind]} ({g.total})
                            </h3>
                            {g.items.length === 0 ? (
                              <p className="text-sm text-fg-tertiary">—</p>
                            ) : (
                              <ul className="space-y-1">
                                {g.items.map((e) => (
                                  <li
                                    key={e.id}
                                    className="flex items-center justify-between gap-2 text-sm"
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      <span className="truncate text-fg-primary">
                                        {e.name}
                                      </span>
                                      {TRUST_TIER_KINDS.has(g.kind) &&
                                        e.trustTier && (
                                          <TrustBadge
                                            tier={e.trustTier}
                                            size="sm"
                                          />
                                        )}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-fg-tertiary">
                                      {Math.round(e.confidence * 100)}%
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
