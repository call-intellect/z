"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import useSWR from "swr";

import { ApiError } from "@/api/api-error";
import {
  documentKindLabel,
  documentTypeLabel,
  documentsApi,
  type DocumentDetailApi,
  type DocumentEntityKindApi,
  type DocumentStatusApi,
} from "@/api/documents.api";
import { useAuth } from "@/contexts/auth-context";
import { buildRenderSegments } from "@/domain/document-render";
import { useRegisterBreadcrumb } from "@/ui/components/breadcrumbs/BreadcrumbContext";
import { Badge } from "@/ui/shadcn/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { TrustBadge } from "@/ui/components/shared/TrustBadge";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from "@app/(admin)/admin/AdminStateViews";

import { SuggestionBanner, hasPendingSuggestion } from "../DocumentsListClient";

const STATUS_LABELS: Record<DocumentStatusApi, string> = {
  uploaded: "загружен",
  parsing: "обрабатывается",
  parsed: "готов",
  failed: "ошибка",
};

const ENTITY_GROUP_LABELS: Record<DocumentEntityKindApi, string> = {
  process: "Процессы",
  decision: "Решения",
  regulation: "Регламенты",
  policy: "Политики",
  metric: "Метрики",
  tool: "Инструменты",
};

const TRUST_TIER_KINDS = new Set<DocumentEntityKindApi>([
  "process",
  "decision",
  "regulation",
  "policy",
]);

export function DocumentDetailClient({ documentId }: { documentId: string }) {
  const { currentOrgId, currentOrgRole, isLoading } = useAuth();
  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках организации."
      />
    );
  }
  const canSeeEntities =
    currentOrgRole === "owner" || currentOrgRole === "admin";
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
    ["document-detail", orgId, documentId],
    () => documentsApi.byId(orgId, documentId),
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) => {
        const s = latest?.document.status;
        return s === "uploaded" || s === "parsing" ? 2000 : 0;
      },
    },
  );

  useRegisterBreadcrumb(
    swr.data?.document ? { label: swr.data.document.name } : null,
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
    if (swr.error instanceof ApiError && swr.error.code === "http_404") {
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
          message={swr.error instanceof Error ? swr.error.message : "Ошибка"}
          onRetry={() => void swr.mutate()}
        />
      </div>
    );
  }
  if (!swr.data) return null;
  return (
    <Detail
      data={swr.data}
      canSeeEntities={canSeeEntities}
      orgId={orgId}
      onChanged={() => void swr.mutate()}
    />
  );
}

function Detail({
  data,
  canSeeEntities,
  orgId,
  onChanged,
}: {
  data: DocumentDetailApi;
  canSeeEntities: boolean;
  orgId: string;
  onChanged: () => void;
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
          {document.docType && (
            <Badge variant="default" className="text-[10px]">
              {documentTypeLabel(document.docType)}
            </Badge>
          )}
          <span className="text-fg-tertiary">
            {documentKindLabel(document.kind)}
          </span>
          {document.attachedRoleId && (
            <Link
              href={`/roles/${encodeURIComponent(document.attachedRoleId)}`}
              className="text-fg-tertiary hover:text-accent"
            >
              {document.attachedRoleName ?? "должность"}
            </Link>
          )}
          {document.uploaderName && (
            <span className="text-fg-tertiary">
              Загрузил: {document.uploaderName}
            </span>
          )}
          {typeof document.sizeBytes === "number" && (
            <span className="text-fg-tertiary">
              {formatBytes(document.sizeBytes)}
            </span>
          )}
        </div>
      </header>

      {hasPendingSuggestion(document) && (
        <div className="mb-6">
          <SuggestionBanner
            orgId={orgId}
            doc={document}
            onChanged={onChanged}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Распознанный текст</CardTitle>
          </CardHeader>
          <CardContent>
            {document.status === "failed" ? (
              <p className="text-sm text-danger">
                Ошибка парсинга. Проверьте файл и попробуйте загрузить ещё раз.
              </p>
            ) : document.status === "parsed" && parsedText ? (
              <HighlightedText
                text={parsedText}
                pageOffsets={document.pageOffsets ?? []}
              />
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
                <TabsTrigger value="entities">Извлечённые сущности</TabsTrigger>
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
                          {typeof b.confidence === "number" && (
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

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function findQuoteRange(
  text: string,
  query: string,
): { start: number; end: number } | null {
  const normalizedQuery = normalizeForMatch(query);
  if (!normalizedQuery) return null;

  const normalizedChars: string[] = [];
  const sourceIndex: number[] = [];
  let prevWasSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (normalizedChars.length === 0 || prevWasSpace) continue;
      normalizedChars.push(" ");
      sourceIndex.push(i);
      prevWasSpace = true;
    } else {
      normalizedChars.push(ch.toLowerCase());
      sourceIndex.push(i);
      prevWasSpace = false;
    }
  }
  while (normalizedChars.length > 0 && normalizedChars[normalizedChars.length - 1] === " ") {
    normalizedChars.pop();
    sourceIndex.pop();
  }

  const haystack = normalizedChars.join("");
  const at = haystack.indexOf(normalizedQuery);
  if (at < 0) return null;
  const start = sourceIndex[at]!;
  const end = sourceIndex[at + normalizedQuery.length - 1]! + 1;
  return { start, end };
}

function PageDivider({ page }: { page: number }) {
  return (
    <div
      id={`doc-page-${page}`}
      className="flex items-center gap-2 py-2 text-xs text-fg-tertiary"
    >
      <span className="h-px flex-1 bg-border-subtle" />
      <span>— Страница {page} —</span>
      <span className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}

function HighlightedText({
  text,
  pageOffsets,
}: {
  text: string;
  pageOffsets: number[];
}) {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const pageParam = searchParams.get("page");
  const markRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const range = useMemo(
    () => (query ? findQuoteRange(text, query) : null),
    [text, query],
  );

  const segments = useMemo(
    () => buildRenderSegments(text, pageOffsets, range),
    [text, pageOffsets, range],
  );

  useEffect(() => {
    if (range && markRef.current) {
      markRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (!range && pageParam && containerRef.current) {
      const target = containerRef.current.querySelector(
        `#doc-page-${CSS.escape(pageParam)}`,
      );
      if (target) {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }
  }, [range, pageParam, segments]);

  if (pageOffsets.length === 0) {
    if (!range) {
      return (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
          {text}
        </pre>
      );
    }
    return (
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
        {text.slice(0, range.start)}
        <mark
          ref={markRef}
          className="rounded bg-accent-muted px-0.5 text-accent-fg"
        >
          {text.slice(range.start, range.end)}
        </mark>
        {text.slice(range.end)}
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-fg-primary"
    >
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg.pageBreakBefore !== null && (
            <PageDivider page={seg.pageBreakBefore} />
          )}
          {seg.isQuote ? (
            <mark
              ref={markRef}
              className="rounded bg-accent-muted px-0.5 text-accent-fg"
            >
              {seg.text}
            </mark>
          ) : (
            seg.text
          )}
        </Fragment>
      ))}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
