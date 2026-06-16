"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Network, Search } from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { entitiesApi, type EntityTypeApi } from "@/api/entities.api";
import { useAuth } from "@/contexts/auth-context";
import {
  ENTITY_TYPE_TABS,
  entityRelationLabel,
  entityTypeLabel,
  mapEntityDetail,
  mapEntityLinks,
  mapEntityListItem,
  signalTypeLabel,
  type EntityDetail,
  type EntityLink,
  type EntityLinksGrouped,
  type EntityListItem,
} from "@/domain/entity";
import { Chip } from "@/ui/components/shared/Chip";
import { EmptyState } from "@/ui/components/shared/EmptyState";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { cn } from "@/ui/shadcn/lib/utils";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

const PAGE_SIZE = 20;

export function EntitiesListClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации."
      />
    );
  }
  return <EntitiesContent />;
}

function EntitiesContent() {
  const [typeFilter, setTypeFilter] = useState<EntityTypeApi | "all">("all");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [items, setItems] = useState<EntityListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setOffset(0);
  }, [typeFilter, qDebounced]);

  const load = useCallback(
    async (currentOffset: number, replace: boolean) => {
      if (replace) {
        setIsLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      setForbidden(false);
      try {
        const resp = await entitiesApi.list({
          type: typeFilter === "all" ? undefined : typeFilter,
          q: qDebounced || undefined,
          limit: PAGE_SIZE,
          offset: currentOffset,
        });
        setTotal(resp.total);
        const mapped = resp.items.map(mapEntityListItem);
        setItems((prev) => (replace ? mapped : [...prev, ...mapped]));
      } catch (e) {
        if (e instanceof ApiError && e.code === "forbidden") {
          setForbidden(true);
        } else {
          setError(humanizeApiError(e, "Не удалось загрузить список"));
        }
      } finally {
        setIsLoading(false);
        setLoadingMore(false);
      }
    },
    [typeFilter, qDebounced],
  );

  useEffect(() => {
    void load(0, true);
  }, [load]);

  const showMore = useCallback(() => {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    void load(next, false);
  }, [offset, load]);

  if (forbidden) {
    return (
      <AdminForbidden
        title="Раздел недоступен"
        description="Этот раздел открыт только менеджерам и руководителям. Обратитесь к администратору компании."
      />
    );
  }
  if (error && items.length === 0)
    return <AdminError message={error} onRetry={() => void load(0, true)} />;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Сущности</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Компании, люди, проекты, продукты и темы, которые Кора выделила из
          встреч и разговоров. Всего: {total}.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTypeFilter("all")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition",
            typeFilter === "all"
              ? "border-accent bg-accent/10 text-accent"
              : "border-border-subtle text-fg-secondary hover:border-border-strong",
          )}
        >
          Все
        </button>
        {ENTITY_TYPE_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTypeFilter(t.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition",
              typeFilter === t.value
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-subtle text-fg-secondary hover:border-border-strong",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию и псевдонимам"
            className="pl-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          {isLoading ? (
            <AdminLoading rows={6} />
          ) : items.length === 0 ? (
            <EmptyState
              title="Сущностей пока нет"
              description="Кора выделяет компании, людей, проекты и продукты из ваших встреч. Они появятся здесь после первых обработанных материалов."
            />
          ) : (
            <>
              <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
                {items.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(e.id)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 px-4 py-3 text-left transition",
                        selectedId === e.id
                          ? "bg-accent/5"
                          : "hover:bg-bg-overlay/40",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <Chip variant="info" size="sm">
                          {entityTypeLabel(e.type)}
                        </Chip>
                        <span className="truncate text-sm font-medium text-fg-primary">
                          {e.canonicalName}
                        </span>
                      </div>
                      <div className="text-xs text-fg-tertiary">
                        Упоминаний: {e.mentionsCount}
                      </div>
                      {e.aliases.length > 0 ? (
                        <div className="line-clamp-1 text-xs text-fg-tertiary">
                          псевдонимы: {e.aliases.join(", ")}
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              {items.length < total ? (
                <div className="mt-3 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    onClick={showMore}
                  >
                    {loadingMore ? "Загружаем…" : "Показать ещё"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
          {selectedId ? (
            <EntityDetailPane
              entityId={selectedId}
              onSelectOther={(otherId) => setSelectedId(otherId)}
            />
          ) : (
            <p className="text-sm text-fg-tertiary">
              Выберите сущность слева, чтобы увидеть связи и блоки знаний.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function EntityDetailPane({
  entityId,
  onSelectOther,
}: {
  entityId: string;
  onSelectOther: (id: string) => void;
}) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [links, setLinks] = useState<EntityLinksGrouped | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllBlocks, setShowAllBlocks] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setShowAllBlocks(false);
    try {
      const [d, l] = await Promise.all([
        entitiesApi.get(entityId),
        entitiesApi.links(entityId),
      ]);
      setDetail(mapEntityDetail(d));
      setLinks(mapEntityLinks(l));
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось загрузить сущность"));
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const allLinks = useMemo(() => {
    if (!links) return [];
    const seen = new Set<string>();
    const out: EntityLink[] = [];
    for (const l of [...links.outgoing, ...links.incoming]) {
      const key = `${l.relationType}:${l.other.entityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(l);
    }
    return out;
  }, [links]);

  if (loading) return <AdminLoading rows={3} />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!detail) return null;

  const visibleBlocks = showAllBlocks
    ? detail.blocks
    : detail.blocks.slice(0, 5);
  const hasMoreBlocks = detail.blocks.length > 5;

  return (
    <article className="space-y-4">
      <header className="space-y-1">
        <Chip variant="info" size="sm">
          {entityTypeLabel(detail.entity.type)}
        </Chip>
        <h2 className="text-lg font-semibold">{detail.entity.canonicalName}</h2>
        {detail.entity.aliases.length > 0 ? (
          <p className="text-xs text-fg-tertiary">
            Псевдонимы: {detail.entity.aliases.join(", ")}
          </p>
        ) : null}
        <p className="text-xs text-fg-tertiary">
          Упоминаний в базе знаний: {detail.entity.mentionsCount}
        </p>
        {detail.mergedIntoId ? (
          <p className="text-xs text-warning">
            Эта сущность объединена с другой — каноническая запись id:{" "}
            <button
              type="button"
              onClick={() => onSelectOther(detail.mergedIntoId!)}
              className="underline hover:text-fg-primary"
            >
              {detail.mergedIntoId.slice(0, 8)}…
            </button>
          </p>
        ) : null}
        <div className="pt-2">
          <Link
            href={`/entities/${encodeURIComponent(detail.entity.id)}/graph`}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <Network size={12} />
            Посмотреть граф связей
          </Link>
        </div>
      </header>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary">
          Связи ({allLinks.length})
        </h3>
        {allLinks.length === 0 ? (
          <p className="text-xs text-fg-tertiary">Связей пока нет.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {allLinks.map((l) => (
              <LinkRow
                key={l.id}
                link={l}
                onClickPeer={() => onSelectOther(l.other.entityId)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary">
          Блоки знаний ({detail.blocks.length})
        </h3>
        {detail.blocks.length === 0 ? (
          <p className="text-xs text-fg-tertiary">
            На этой сущности ещё нет блоков знаний.
          </p>
        ) : (
          <ul className="space-y-2">
            {visibleBlocks.map((b) => (
              <li
                key={b.id}
                className="rounded-md border border-border-subtle bg-bg-overlay/20 p-3"
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Chip variant="info" size="sm">
                    {signalTypeLabel(b.signalType)}
                  </Chip>
                  <span className="text-sm font-medium text-fg-primary">
                    {b.name}
                  </span>
                </div>
                <p className="line-clamp-3 text-xs text-fg-secondary">
                  {b.trustedAnswer}
                </p>
                <p className="mt-1 text-xs text-fg-tertiary">
                  {b.evidenceCount} источников ·{" "}
                  {b.createdAt.toLocaleDateString("ru-RU")}
                </p>
              </li>
            ))}
          </ul>
        )}
        {hasMoreBlocks ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAllBlocks((s) => !s)}
            className="text-xs"
          >
            {showAllBlocks
              ? "Свернуть"
              : `Показать все ${detail.blocks.length}`}
          </Button>
        ) : null}
      </section>
    </article>
  );
}

function LinkRow({
  link,
  onClickPeer,
}: {
  link: EntityLink;
  onClickPeer: () => void;
}) {
  const arrow = link.direction === "outgoing" ? "⟶" : "←";
  const showConfidence = link.confidence >= 0.85;
  return (
    <li className="flex flex-wrap items-baseline gap-1 text-fg-secondary">
      <span className="text-fg-tertiary">{arrow}</span>
      <span>{entityRelationLabel(link.relationType)}</span>
      <button
        type="button"
        onClick={onClickPeer}
        className="underline-offset-2 hover:underline"
      >
        «{link.other.canonicalName}»
      </button>
      <span className="text-xs text-fg-tertiary">
        ({entityTypeLabel(link.other.type)})
      </span>
      {showConfidence ? (
        <span className="text-xs text-fg-tertiary">
          · уверенность {(link.confidence * 100).toFixed(0)}%
        </span>
      ) : null}
    </li>
  );
}
