'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import { curationApi, type CurationItemApi } from '@/api/curation.api';
import { useAuth } from '@/contexts/auth-context';
import {
  curationLevelLabel,
  mapCurationItem,
  type CurationItem,
} from '@/domain/curation';

/**
 * <CurationBanner> — inline-виджет Слоя 4 (SBA α-4 §6.2).
 *
 * Показывается на странице карточки специалиста (Regulation, Decision,
 * Process, ...). Если для пары `(resourceType, resourceId)` есть открытый
 * `CurationItem` И текущий пользователь — кандидат-куратор (или назначен) —
 * показывает короткий баннер «На проверке» с кнопками «Открыть» / «Одобрить»
 * / «Отклонить». Если нет — рендерит null.
 *
 * На α-4 — задел; интеграция в страницы карточек — задача α-6 / α-7 / γ-1
 * (когда появятся UI карточек специалистов).
 */
export function CurationBanner({
  resourceType,
  resourceId,
}: {
  resourceType: string;
  resourceId: string;
}) {
  const { user } = useAuth();
  const [item, setItem] = useState<CurationItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await curationApi.listQueue({
          resourceType,
          resourceId,
          status: 'pending',
          limit: 1,
        });
        if (cancelled) return;
        const first: CurationItemApi | undefined = res.items[0];
        setItem(first ? mapCurationItem(first) : null);
      } catch (e) {
        if (cancelled) return;
        // Тихая ошибка: для inline-виджета не показываем ничего, чтобы не
        // мешать основной странице.
        setError(e instanceof ApiError ? e.message : 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [resourceType, resourceId]);

  if (loading || error || !item || !user) return null;

  const isCandidate =
    item.candidateCuratorIds.includes(user.id) ||
    item.assignedToUserId === user.id;
  if (!isCandidate) return null;

  async function decide(decisionType: 'approve' | 'reject') {
    if (!item) return;
    setSubmitting(true);
    try {
      await curationApi.decide(item.id, { decisionType });
      setItem(null);
    } catch {
      // ignore — пользователь увидит ошибку при следующем действии.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
      <div>
        <div className="font-medium">Карточка на проверке</div>
        <div className="mt-0.5 text-xs text-fg-tertiary">
          Уровень: {curationLevelLabel(item.level)}
          {item.confidence !== null && (
            <> · уверенность {(item.confidence * 100).toFixed(0)}%</>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Link
          href={`/curation/${item.id}`}
          className="rounded-md border border-border-subtle px-3 py-1 text-xs hover:bg-bg-hover"
        >
          Открыть
        </Link>
        {item.level === 'light' && (
          <>
            <button
              type="button"
              onClick={() => void decide('approve')}
              disabled={submitting}
              className="rounded-md bg-accent px-3 py-1 text-xs text-accent-fg disabled:opacity-50"
            >
              Одобрить
            </button>
            <button
              type="button"
              onClick={() => void decide('reject')}
              disabled={submitting}
              className="rounded-md border border-danger/40 px-3 py-1 text-xs text-danger disabled:opacity-50"
            >
              Отклонить
            </button>
          </>
        )}
      </div>
    </div>
  );
}
