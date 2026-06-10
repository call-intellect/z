'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  curationApi,
  type CurationDecisionTypeApi,
  type CurationItemStatusApi,
  type CurationLevelApi,
} from '@/api/curation.api';
import { useAuth } from '@/contexts/auth-context';
import {
  completenessCardTypeLabel,
  completenessSlotNameLabel,
  completenessSlotStatusLabel,
  mapCompletenessSlot,
  type CompletenessParentCardType,
  type CompletenessSlot,
} from '@/domain/completeness-slot';
import {
  conflictResolutionLabel,
  conflictStatusLabel,
  curationDecisionLabel,
  curationLevelLabel,
  curationStatusLabel,
  mapConflictItem,
  mapCurationItem,
  mapCurationItemDetail,
  type ConflictItem,
  type CurationItem,
  type CurationItemDetail,
} from '@/domain/curation';
import { resourceTypeRu } from '@/domain/resource-type';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { ReadablePayload } from './ReadablePayload';

const COMPLETENESS_CARD_TYPES_BY_RESOURCE: Partial<
  Record<string, CompletenessParentCardType>
> = {
  regulation: 'regulation',
  process: 'process',
  role: 'role',
  company_profile: 'company_profile',
};

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

const LEVEL_OPTIONS: Array<{ value: CurationLevelApi | ''; label: string }> = [
  { value: '', label: 'Любой уровень' },
  { value: 'light', label: 'Простая' },
  { value: 'deep', label: 'Подробная' },
];

const STATUS_OPTIONS: Array<{ value: CurationItemStatusApi | ''; label: string }> = [
  { value: '', label: 'Любой статус' },
  { value: 'pending', label: 'На проверке' },
  { value: 'decided', label: 'Решена' },
  { value: 'expired', label: 'Просрочена' },
  { value: 'cancelled', label: 'Отменена' },
];

/**
 * `/curation` — Master-detail UI Слоя 4 (SBA α-4).
 *
 * Левая колонка — фильтры + список CurationItem. Правая — детальная страница
 * выбранной карточки с payload'ом, провенансом и кнопками decision.
 */
export function CurationQueueClient() {
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
  return <CurationQueueContent />;
}

function CurationQueueContent() {
  const [items, setItems] = useState<CurationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CurationItemDetail | null>(null);
  const [relatedConflicts, setRelatedConflicts] = useState<ConflictItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  /// SBA α-4 wave 2 — счётчик открытых CompletenessSlot по всей Org (для виджета хедера).
  const [openSlotsTotal, setOpenSlotsTotal] = useState<number | null>(null);

  const [level, setLevel] = useState<CurationLevelApi | ''>('');
  const [status, setStatus] = useState<CurationItemStatusApi | ''>('pending');
  const [resourceType, setResourceType] = useState('');
  const [assignedToMe, setAssignedToMe] = useState(false);

  const filters = useMemo(
    () => ({
      level: level || undefined,
      status: status || undefined,
      resourceType: resourceType.trim() || undefined,
      assignedToMe: assignedToMe || undefined,
      limit: 100,
    }),
    [level, status, resourceType, assignedToMe],
  );

  const loadQueue = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await curationApi.listQueue(filters);
      const mapped = res.items.map(mapCurationItem);
      setItems(mapped);
      setTotal(res.total);
      if (mapped.length > 0) {
        const first = mapped[0];
        if (first) {
          setSelectedId((prev) => prev ?? first.id);
        }
      } else {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Не удалось загрузить очередь');
      }
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const apiDetail = await curationApi.getItem(id);
        const mapped = mapCurationItemDetail(apiDetail);
        setDetail(mapped);
        // Подтянуть связанные конфликты (опц.).
        if (mapped.relatedConflictIds.length > 0) {
          try {
            const list = await curationApi.listConflicts({ status: 'open' });
            const set = new Set(mapped.relatedConflictIds);
            setRelatedConflicts(
              list.items.map(mapConflictItem).filter((c) => set.has(c.id)),
            );
          } catch {
            setRelatedConflicts([]);
          }
        } else {
          setRelatedConflicts([]);
        }
      } catch (e) {
        setError(
          e instanceof ApiError ? e.message : 'Не удалось загрузить детали',
        );
      }
    },
    [],
  );

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
      setRelatedConflicts([]);
    }
  }, [selectedId, loadDetail]);

  // SBA α-4 wave 2 — счётчик открытых слотов (для виджета в хедере).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await curationApi.listCompletenessSlots({
          status: 'open',
          take: 1,
        });
        if (active) setOpenSlotsTotal(res.totalCount);
      } catch {
        if (active) setOpenSlotsTotal(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (isLoading && items.length === 0) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error)
    return <AdminError message={error} onRetry={() => void loadQueue()} />;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Проверка карточек</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Очередь карточек на проверке. Всего: {total}.
          {openSlotsTotal !== null && (
            <>
              {' '}
              <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/5 px-2 py-0.5 text-xs">
                Незаполненных слотов: {openSlotsTotal}
              </span>
            </>
          )}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[420px,1fr]">
        {/* Master: фильтры + список */}
        <section className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border-subtle bg-bg-card p-4">
            <div className="flex flex-wrap gap-2">
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as CurationLevelApi | '')}
                className="rounded-md border border-border-subtle bg-bg-input px-2 py-1 text-sm"
              >
                {LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as CurationItemStatusApi | '')
                }
                className="rounded-md border border-border-subtle bg-bg-input px-2 py-1 text-sm"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <Input
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              placeholder="Тип карточки (например, regulation)"
              className="text-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={assignedToMe}
                onChange={(e) => setAssignedToMe(e.target.checked)}
              />
              Только мои
            </label>
          </div>

          {items.length === 0 ? (
            <AdminEmpty
              title="Карточек на проверке нет"
              description="Когда специалисты предложат новые карточки, они появятся здесь."
            />
          ) : (
            <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(it.id)}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition ${
                      selectedId === it.id ? 'bg-bg-hover' : 'hover:bg-bg-hover/50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{resourceTypeRu(it.resourceType)}</span>
                      <span className="text-xs text-fg-tertiary">
                        {curationLevelLabel(it.level)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-fg-tertiary">
                      <span>{curationStatusLabel(it.status)}</span>
                      {it.confidence !== null && (
                        <span>{(it.confidence * 100).toFixed(0)}%</span>
                      )}
                      {it.isStale && <span className="text-warning">устаревшая</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Detail */}
        <section>
          {detail ? (
            <CurationDetailPanel
              item={detail}
              conflicts={relatedConflicts}
              onAfterDecide={() => {
                setSelectedId(null);
                void loadQueue();
              }}
              onAfterConflictResolved={() => {
                if (selectedId) void loadDetail(selectedId);
              }}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border-subtle p-12 text-center text-sm text-fg-tertiary">
              Выберите карточку слева, чтобы увидеть детали.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CurationDetailPanel({
  item,
  conflicts,
  onAfterDecide,
  onAfterConflictResolved,
}: {
  item: CurationItemDetail;
  conflicts: ConflictItem[];
  onAfterDecide: () => void;
  onAfterConflictResolved: () => void;
}) {
  const [decisionType, setDecisionType] =
    useState<CurationDecisionTypeApi>('approve');
  const [reasoning, setReasoning] = useState('');
  const [payloadText, setPayloadText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      let payload: Record<string, unknown> | undefined;
      if (payloadText.trim()) {
        try {
          payload = JSON.parse(payloadText) as Record<string, unknown>;
        } catch {
          setError('Поле «правки» должно быть валидным JSON-объектом');
          setSubmitting(false);
          return;
        }
      }
      await curationApi.decide(item.id, {
        decisionType,
        payload,
        reasoning: reasoning.trim() || undefined,
      });
      onAfterDecide();
    } catch (e) {
      setError(humanizeApiError(e, 'Не удалось сохранить решение'));
    } finally {
      setSubmitting(false);
    }
  }, [decisionType, item.id, onAfterDecide, payloadText, reasoning]);

  const isPending = item.status === 'pending';
  const canEdit = isPending;
  const requiresReasoning =
    item.level === 'deep' ||
    decisionType === 'split' ||
    decisionType === 'merge' ||
    decisionType === 'supersede';

  return (
    <div className="space-y-4 rounded-lg border border-border-subtle bg-bg-card p-6">
      <header>
        <div className="text-xs uppercase tracking-wide text-fg-tertiary">
          {resourceTypeRu(item.resourceType)}
        </div>
        <h2 className="mt-1 text-xl font-semibold">Требует вашей проверки</h2>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-fg-tertiary">
          <span>{curationLevelLabel(item.level)}</span>
          <span>{curationStatusLabel(item.status)}</span>
          {item.confidence !== null && (
            <span>уверенность {(item.confidence * 100).toFixed(0)}%</span>
          )}
          <span>создана {item.createdAt.toLocaleString('ru-RU')}</span>
          {item.expiresAt && (
            <span>истекает {item.expiresAt.toLocaleString('ru-RU')}</span>
          )}
        </div>
      </header>

      <section>
        <h3 className="mb-1 text-sm font-medium">Предлагается канонизировать</h3>
        <ReadablePayload value={item.proposedPayload} />
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium">Почему сюда попала</h3>
        <ReadablePayload value={item.triageReason} />
      </section>

      {/* SBA α-4 wave 2 — Вкладка «Полнота карточки». Показывается только для
          4 нормативных типов (regulation/process/role/company_profile). */}
      {COMPLETENESS_CARD_TYPES_BY_RESOURCE[item.resourceType] && (
        <CompletenessPanel
          cardType={
            COMPLETENESS_CARD_TYPES_BY_RESOURCE[item.resourceType] as CompletenessParentCardType
          }
          cardId={item.resourceId}
        />
      )}

      {conflicts.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Связанные конфликты</h3>
          <ul className="space-y-2">
            {conflicts.map((c) => (
              <ConflictRow
                key={c.id}
                conflict={c}
                onResolved={onAfterConflictResolved}
              />
            ))}
          </ul>
        </section>
      )}

      {item.decisions.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Решения</h3>
          <ul className="space-y-2">
            {item.decisions.map((d) => (
              <li
                key={d.id}
                className="rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {curationDecisionLabel(d.decisionType)}
                  </span>
                  <span className="text-xs text-fg-tertiary">
                    {d.createdAt.toLocaleString('ru-RU')}
                  </span>
                </div>
                {d.reasoning && (
                  <p className="mt-1 text-xs text-fg-secondary">{d.reasoning}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <section className="space-y-3 border-t border-border-subtle pt-4">
          <h3 className="text-sm font-medium">Принять решение</h3>
          <div className="flex flex-wrap gap-2">
            {(
              [
                'approve',
                'approve_with_edits',
                'reject',
                'split',
                'merge',
                'supersede',
              ] as const
            ).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDecisionType(t)}
                className={`rounded-md border px-3 py-1 text-xs ${
                  decisionType === t
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-subtle hover:bg-bg-hover'
                }`}
              >
                {curationDecisionLabel(t)}
              </button>
            ))}
          </div>

          {(decisionType === 'approve_with_edits' ||
            decisionType === 'split' ||
            decisionType === 'merge' ||
            decisionType === 'supersede') && (
            <div>
              <label className="mb-1 block text-xs text-fg-tertiary">
                Правки (JSON-объект)
              </label>
              <textarea
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                placeholder={'{"key": "value"}'}
                className="w-full rounded-md border border-border-subtle bg-bg-input p-2 font-mono text-xs"
                rows={6}
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-fg-tertiary">
              Обоснование {requiresReasoning ? '(обязательно)' : '(опц.)'}
            </label>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              placeholder="Почему вы приняли такое решение"
              rows={3}
              className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end">
            <Button onClick={submit} disabled={submitting}>
              {submitting ? 'Сохраняем…' : 'Сохранить решение'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ConflictRow({
  conflict,
  onResolved,
}: {
  conflict: ConflictItem;
  onResolved: () => void;
}) {
  const [resolution, setResolution] = useState<
    'accept_new' | 'keep_old' | 'merge' | 'evolving'
  >('accept_new');
  const [existingValidUntil, setExistingValidUntil] = useState('');
  const [newValidFrom, setNewValidFrom] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (resolution === 'evolving' && (!existingValidUntil || !newValidFrom)) {
      setError(
        'Для типа «Эволюция» обязательны обе даты: «старое действовало до» и «новое действует с»',
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await curationApi.resolveConflict(conflict.id, {
        resolution,
        evolvingMeta:
          resolution === 'evolving'
            ? {
                existingValidUntil: new Date(existingValidUntil).toISOString(),
                newValidFrom: new Date(newValidFrom).toISOString(),
              }
            : undefined,
        reasoning: reasoning.trim() || undefined,
      });
      onResolved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось разрешить конфликт');
    } finally {
      setSubmitting(false);
    }
  }, [
    conflict.id,
    existingValidUntil,
    newValidFrom,
    onResolved,
    reasoning,
    resolution,
  ]);

  return (
    <li className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {resourceTypeRu(conflict.resourceType)}: {conflict.existingId} ↔ {conflict.newId}
        </span>
        <span className="text-xs">{conflictStatusLabel(conflict.status)}</span>
      </div>
      <div className="text-xs text-fg-tertiary">
        {conflict.relationType} · обнаружен: {conflict.detectedBy}
      </div>
      <div className="flex flex-wrap gap-2">
        {(['accept_new', 'keep_old', 'merge', 'evolving'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setResolution(r)}
            className={`rounded-md border px-2 py-0.5 text-xs ${
              resolution === r
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle'
            }`}
          >
            {conflictResolutionLabel(r)}
          </button>
        ))}
      </div>
      {resolution === 'evolving' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-fg-tertiary">
            Старое действовало до
            <Input
              type="datetime-local"
              value={existingValidUntil}
              onChange={(e) => setExistingValidUntil(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="text-xs text-fg-tertiary">
            Новое действует с
            <Input
              type="datetime-local"
              value={newValidFrom}
              onChange={(e) => setNewValidFrom(e.target.value)}
              className="mt-1"
            />
          </label>
        </div>
      )}
      <textarea
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
        placeholder="Обоснование решения (опц.)"
        rows={2}
        className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-xs"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? 'Сохраняем…' : 'Разрешить'}
        </Button>
      </div>
    </li>
  );
}

/**
 * SBA α-4 wave 2 — секция «Полнота карточки».
 * Показывается только для 4 нормативных типов (regulation/process/role/company_profile).
 */
function CompletenessPanel({
  cardType,
  cardId,
}: {
  cardType: CompletenessParentCardType;
  cardId: string;
}) {
  const [slots, setSlots] = useState<CompletenessSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await curationApi.listCompletenessSlots({
        cardType,
        cardId,
        take: 50,
      });
      setSlots(res.items.map(mapCompletenessSlot));
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Не удалось загрузить слоты',
      );
    } finally {
      setIsLoading(false);
    }
  }, [cardType, cardId]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = slots.filter((s) => s.status === 'open');
  const filled = slots.filter((s) => s.status === 'filled');

  const onMarkFilled = useCallback(
    async (slotId: string) => {
      try {
        await curationApi.markCompletenessSlotFilled(slotId);
        await load();
      } catch (e) {
        setError(
          e instanceof ApiError
            ? e.message
            : 'Не удалось пометить слот заполненным',
        );
      }
    },
    [load],
  );

  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">
        Полнота карточки ({completenessCardTypeLabel(cardType)})
      </h3>
      {isLoading ? (
        <p className="text-xs text-fg-tertiary">Загружаем слоты…</p>
      ) : error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : slots.length === 0 ? (
        <p className="text-xs text-fg-tertiary">
          Слоты для этой карточки ещё не сгенерированы. После ближайшего
          прохода сканера полноты — появятся здесь.
        </p>
      ) : (
        <div className="space-y-3">
          {open.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-fg-tertiary">
                Открытые ({open.length})
              </div>
              <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-bg-input">
                {open.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">
                        {completenessSlotNameLabel(s.slotName)}
                      </div>
                      <div className="text-xs text-fg-tertiary">
                        {s.slotKind === 'required'
                          ? 'обязательный'
                          : 'желательный'}{' '}
                        · {completenessSlotStatusLabel(s.status)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void onMarkFilled(s.id)}
                    >
                      Заполнить
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {filled.length > 0 && (
            <details className="rounded-md border border-border-subtle bg-bg-input">
              <summary className="cursor-pointer px-3 py-2 text-xs text-fg-tertiary">
                Заполненные ({filled.length})
              </summary>
              <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                {filled.map((s) => (
                  <li
                    key={s.id}
                    className="px-3 py-2 text-xs text-fg-secondary"
                  >
                    {completenessSlotNameLabel(s.slotName)}
                    {s.filledAt && (
                      <span className="ml-2 text-fg-tertiary">
                        · {s.filledAt.toLocaleString('ru-RU')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
