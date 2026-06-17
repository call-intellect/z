'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  curationApi,
  type CurationDecisionTypeApi,
} from '@/api/curation.api';
import { useAuth } from '@/contexts/auth-context';
import {
  curationDecisionLabel,
  curationLevelLabel,
  curationStatusLabel,
  mapCurationItemDetail,
  triageReasonSummary,
  type CurationDecisionType,
  type CurationLevel,
} from '@/domain/curation';
import { resourceTypeRu } from '@/domain/resource-type';
import { Button } from '@/ui/shadcn/button';
import { ReadablePayload } from '@/ui/readable-payload';
import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * Какие типы решений требуют обязательного обоснования (reasoning) независимо
 * от уровня. Для `deep`-уровня обоснование обязательно для ЛЮБОГО типа.
 *
 * Вынесено отдельным экспортом, чтобы покрыть чистой unit-логикой
 * (см. `CurationDetailClient.spec.ts`).
 */
const REASONING_REQUIRED_TYPES: ReadonlySet<CurationDecisionType> = new Set([
  'split',
  'merge',
  'supersede',
  'merge_categories',
  'escalate',
]);

export function isReasoningRequired(
  level: CurationLevel,
  decisionType: CurationDecisionType,
): boolean {
  if (level === 'deep') return true;
  return REASONING_REQUIRED_TYPES.has(decisionType);
}

/**
 * Полный список типов решений, доступных куратору на detail-странице.
 * Совпадает с `CurationDecisionType` из domain-слоя (8 значений).
 */
const DECISION_TYPES: readonly CurationDecisionType[] = [
  'approve',
  'approve_with_edits',
  'reject',
  'split',
  'merge',
  'supersede',
  'merge_categories',
  'escalate',
];

/**
 * Org-роли, которым разрешён доступ к курации помимо curator-кандидата.
 *
 * Должно совпадать с backend RBAC (`policy.csv`): чтение/решение по
 * `curation_item` имеют ТОЛЬКО owner/admin. Грант manager-self покрывается на
 * фронте проверкой `candidateCuratorIds`, поэтому coo здесь быть НЕ должно —
 * иначе coo проходит клиентский гейт, но получает 403 от `getItem`/`decide`.
 */
const CURATOR_ORG_ROLES = new Set<string>(['owner', 'admin']);

export function CurationDetailClient({ itemId }: { itemId: string }) {
  const { user, isLoading: authLoading, currentOrgId, currentOrgRole, isSuperAdmin } =
    useAuth();

  const itemSwr = useSWR(['curation-item', itemId], async () => {
    const api = await curationApi.getItem(itemId);
    return mapCurationItemDetail(api);
  });

  if (authLoading || (itemSwr.isLoading && !itemSwr.data && !itemSwr.error)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminLoading rows={6} />
      </div>
    );
  }

  if (!currentOrgId) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminForbidden
          title="Нет организации"
          description="Вы не состоите ни в одной компании, поэтому курация недоступна."
        />
      </div>
    );
  }

  if (itemSwr.error) {
    const notFound =
      itemSwr.error instanceof ApiError &&
      (itemSwr.error.code === 'curation_item_not_found' ||
        itemSwr.error.code === 'http_404' ||
        itemSwr.error.code === 'forbidden' ||
        itemSwr.error.code === 'http_403');
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        {notFound ? (
          <AdminForbidden
            title="Карточка не найдена"
            description="Карточка курации не существует или у вас нет к ней доступа."
          />
        ) : (
          <AdminError
            message={
              itemSwr.error instanceof ApiError
                ? itemSwr.error.message
                : 'Не удалось загрузить карточку курации'
            }
            onRetry={() => void itemSwr.mutate()}
          />
        )}
        <Button asChild variant="ghost" className="mt-3 gap-1 text-fg-tertiary">
          <Link href="/curation">
            <ChevronLeft size={16} /> К очереди проверки
          </Link>
        </Button>
      </div>
    );
  }

  const item = itemSwr.data;
  if (!item) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminLoading rows={6} />
      </div>
    );
  }

  // Роль-гейт: owner/admin ИЛИ super-admin ИЛИ curator-кандидат по этой
  // конкретной карточке (user.id ∈ candidateCuratorIds).
  const hasOrgRole =
    !!currentOrgRole && CURATOR_ORG_ROLES.has(currentOrgRole);
  const isCandidate = !!user && item.candidateCuratorIds.includes(user.id);
  const allowed = isSuperAdmin || hasOrgRole || isCandidate;

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminForbidden
          title="Доступ запрещён"
          description="Проверять эту карточку могут владелец, администратор или назначенный куратор."
        />
        <Button asChild variant="ghost" className="mt-3 gap-1 text-fg-tertiary">
          <Link href="/curation">
            <ChevronLeft size={16} /> К очереди проверки
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <CurationDetailView
      item={item}
      onAfterDecide={() => void itemSwr.mutate()}
    />
  );
}

function CurationDetailView({
  item,
  onAfterDecide,
}: {
  item: ReturnType<typeof mapCurationItemDetail>;
  onAfterDecide: () => void;
}) {
  const router = useRouter();

  const [decisionType, setDecisionType] =
    useState<CurationDecisionTypeApi>('approve');
  const [reasoning, setReasoning] = useState('');
  const [payloadText, setPayloadText] = useState(() =>
    JSON.stringify(item.proposedPayload, null, 2),
  );
  const [escalateToUserId, setEscalateToUserId] = useState('');
  const [sourceCategoryId, setSourceCategoryId] = useState('');
  const [targetCategoryId, setTargetCategoryId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isPending = item.status === 'pending';
  const reasoningRequired = isReasoningRequired(item.level, decisionType);

  // Блокирующая валидация submit. Возвращает текст подсказки (почему нельзя) или
  // null если всё валидно.
  const blockReason = useMemo<string | null>(() => {
    if (reasoningRequired && !reasoning.trim()) {
      return 'Для этого решения обоснование обязательно.';
    }
    if (decisionType === 'escalate' && !escalateToUserId.trim()) {
      return 'Укажите, кому передать карточку (ID куратора).';
    }
    if (
      decisionType === 'merge_categories' &&
      (!sourceCategoryId.trim() || !targetCategoryId.trim())
    ) {
      return 'Укажите ID исходной и целевой категорий.';
    }
    if (
      decisionType === 'merge_categories' &&
      sourceCategoryId.trim() === targetCategoryId.trim()
    ) {
      // Backend (`curation.service.ts`) отклоняет src === tgt — ловим заранее.
      return 'Категории должны быть разными.';
    }
    return null;
  }, [
    reasoningRequired,
    reasoning,
    decisionType,
    escalateToUserId,
    sourceCategoryId,
    targetCategoryId,
  ]);

  const submit = useCallback(async () => {
    if (blockReason) return;

    let payload: Record<string, unknown> | undefined;
    if (decisionType === 'approve_with_edits') {
      try {
        const parsed = JSON.parse(payloadText) as unknown;
        if (
          parsed === null ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed)
        ) {
          toast.error('Правки должны быть JSON-объектом, а не списком или значением');
          return;
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        toast.error('Правки должны быть валидным JSON-объектом');
        return;
      }
    } else if (decisionType === 'escalate') {
      payload = { escalateToUserId: escalateToUserId.trim() };
    } else if (decisionType === 'merge_categories') {
      payload = {
        sourceCategoryId: sourceCategoryId.trim(),
        targetCategoryId: targetCategoryId.trim(),
      };
    }

    setSubmitting(true);
    try {
      await curationApi.decide(item.id, {
        decisionType,
        ...(payload ? { payload } : {}),
        ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
      });
      toast.success('Решение применено');
      onAfterDecide();
      router.push('/curation');
    } catch (e) {
      toast.error(
        humanizeApiError(e, 'Не удалось применить решение'),
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    blockReason,
    decisionType,
    payloadText,
    escalateToUserId,
    sourceCategoryId,
    targetCategoryId,
    reasoning,
    item.id,
    onAfterDecide,
    router,
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="gap-1 text-fg-tertiary">
          <Link href="/curation">
            <ChevronLeft size={16} /> К очереди проверки
          </Link>
        </Button>
      </div>

      {/* Заголовок */}
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-fg-tertiary">
          {resourceTypeRu(item.resourceType)}
        </div>
        <h1 className="mt-1 text-2xl font-semibold">Требует вашей проверки</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-border-subtle bg-bg-overlay px-2 py-0.5 text-fg-secondary">
            {curationLevelLabel(item.level)}
          </span>
          <span className="rounded-full border border-border-subtle bg-bg-overlay px-2 py-0.5 text-fg-secondary">
            {curationStatusLabel(item.status)}
          </span>
          {item.confidence !== null && (
            <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent">
              уверенность {(item.confidence * 100).toFixed(0)}%
            </span>
          )}
          {item.isStale && (
            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
              устаревшая
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-tertiary">
          <span>создана {item.createdAt.toLocaleString('ru-RU')}</span>
          {item.decidedAt && (
            <span>решение {item.decidedAt.toLocaleString('ru-RU')}</span>
          )}
          {item.expiresAt && (
            <span>истекает {item.expiresAt.toLocaleString('ru-RU')}</span>
          )}
        </div>
      </header>

      {/* Почему сюда попала */}
      <section className="mb-6">
        <h2 className="mb-1 text-sm font-medium">Почему сюда попала</h2>
        <p className="rounded-md border border-border-subtle bg-bg-card p-3 text-sm text-fg-secondary">
          {triageReasonSummary(item.triageReason)}
        </p>
      </section>

      {/* Предлагаемые данные */}
      <section className="mb-6">
        <h2 className="mb-1 text-sm font-medium">Предлагается канонизировать</h2>
        <ReadablePayload value={item.proposedPayload} />
      </section>

      {/* Связанные конфликты */}
      {item.relatedConflictIds.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium">Связанные конфликты</h2>
          <ul className="space-y-1">
            {item.relatedConflictIds.map((cid, idx) => (
              <li key={cid}>
                <Link
                  href={`/curation/conflicts/${encodeURIComponent(cid)}`}
                  className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/5 px-2 py-1 text-xs text-warning underline-offset-2 hover:underline"
                >
                  Конфликт {idx + 1}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* История решений */}
      {item.decisions.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium">История решений</h2>
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

      {/* Панель решения */}
      {isPending ? (
        <section className="space-y-3 rounded-lg border border-border-subtle bg-bg-card p-5">
          <h2 className="text-sm font-medium">Принять решение</h2>

          <div>
            <label
              htmlFor="curation-decision-type"
              className="mb-1 block text-xs text-fg-tertiary"
            >
              Тип решения
            </label>
            <select
              id="curation-decision-type"
              value={decisionType}
              onChange={(e) =>
                setDecisionType(e.target.value as CurationDecisionTypeApi)
              }
              className="w-full rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm"
            >
              {DECISION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {curationDecisionLabel(t)}
                </option>
              ))}
            </select>
          </div>

          {decisionType === 'approve_with_edits' && (
            <div>
              <label
                htmlFor="curation-payload"
                className="mb-1 block text-xs text-fg-tertiary"
              >
                Данные с правками (JSON-объект)
              </label>
              <textarea
                id="curation-payload"
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                rows={8}
                className="w-full rounded-md border border-border-subtle bg-bg-input p-2 font-mono text-xs"
              />
            </div>
          )}

          {decisionType === 'escalate' && (
            <div>
              <label
                htmlFor="curation-escalate-to"
                className="mb-1 block text-xs text-fg-tertiary"
              >
                Кому передать (ID куратора)
              </label>
              <input
                id="curation-escalate-to"
                value={escalateToUserId}
                onChange={(e) => setEscalateToUserId(e.target.value)}
                placeholder="user-id"
                className="w-full rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm"
              />
            </div>
          )}

          {decisionType === 'merge_categories' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="curation-source-category"
                  className="mb-1 block text-xs text-fg-tertiary"
                >
                  Исходная категория (ID)
                </label>
                <input
                  id="curation-source-category"
                  value={sourceCategoryId}
                  onChange={(e) => setSourceCategoryId(e.target.value)}
                  placeholder="source-id"
                  className="w-full rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="curation-target-category"
                  className="mb-1 block text-xs text-fg-tertiary"
                >
                  Целевая категория (ID)
                </label>
                <input
                  id="curation-target-category"
                  value={targetCategoryId}
                  onChange={(e) => setTargetCategoryId(e.target.value)}
                  placeholder="target-id"
                  className="w-full rounded-md border border-border-subtle bg-bg-input px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="curation-reasoning"
              className="mb-1 block text-xs text-fg-tertiary"
            >
              Обоснование {reasoningRequired ? '(обязательно)' : '(опц.)'}
            </label>
            <textarea
              id="curation-reasoning"
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              placeholder="Почему вы приняли такое решение"
              rows={3}
              className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm"
            />
          </div>

          {blockReason && (
            <p className="text-xs text-warning">{blockReason}</p>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => void submit()}
              disabled={submitting || !!blockReason}
            >
              {submitting ? 'Применяем…' : 'Применить решение'}
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-dashed border-border-subtle p-6 text-center text-sm text-fg-tertiary">
          По этой карточке решение уже принято или она больше не на проверке.
        </section>
      )}
    </div>
  );
}
