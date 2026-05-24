'use client';

/**
 * IssueSimilar — блок «Похожие задачи» на странице задачи.
 *
 * Phase 3 (Sprint 6): KNN-поиск по embedding'у задачи. Backend выдаёт
 * `SimilarIssueDto[]` уже отсортированный по similarity desc и
 * отфильтрованный по threshold (по умолчанию ≥ 0.82). На фронте
 * показываем только если массив непустой.
 *
 * Каждая карточка похожей задачи:
 *   - identifier (моноширинный, `KORA-123`)
 *   - title (truncate на mobile)
 *   - бейдж «N% похожа»
 *   - бейдж статуса (Готово/Отменено — обычно похожие приходят закрытые,
 *     но рисуем по факту)
 *   - relative completedAt («3 дн. назад») если задача завершена
 *   - кнопка «Посмотреть» → ссылка на `/issues/{id}`
 *
 * Mobile-first: одна колонка; на md+ — 2 колонки.
 */

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import { useSimilarIssues } from '@/hooks/tracker/useSimilarIssues';
import {
  relativeDateLabel,
  similarityLabel,
  type SimilarIssue,
} from '@/domain/tracker';
import { Badge } from '@/ui/shadcn/badge';

export function IssueSimilar({
  orgId,
  issueId,
}: {
  orgId: string;
  issueId: string;
}) {
  const { similar, isLoading, error } = useSimilarIssues(orgId, issueId);

  // Во время первой загрузки рендерим placeholder с заголовком —
  // визуально подсказывает пользователю, что блок скоро появится.
  if (isLoading) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-fg-primary">Похожие задачи</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
            />
          ))}
        </div>
      </section>
    );
  }

  // Тихая ошибка: KNN — вспомогательный блок, при сбое лучше не пугать
  // пользователя ярким баннером. Логируем в консоль, но рендерим пустоту.
  if (error) {
    console.warn('IssueSimilar: failed to load similar issues', error);
    return null;
  }

  // Условие из ТЗ: блок скрыт целиком, если похожих нет.
  if (similar.length === 0) return null;

  // Если ВСЕ похожие закрыты — называем секцию «Похожие задачи (закрытые)»,
  // как в ТЗ. Иначе нейтральное «Похожие задачи».
  const allCompleted = similar.every((item) => item.completedAt !== null);
  const heading = allCompleted ? 'Похожие задачи (закрытые)' : 'Похожие задачи';

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-fg-primary">{heading}</h2>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {similar.map((item) => (
          <SimilarIssueCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function SimilarIssueCard({ item }: { item: SimilarIssue }) {
  const completed = relativeDateLabel(item.completedAt);

  return (
    <article
      className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3"
      aria-label={`Похожая задача ${item.identifier}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-fg-tertiary">
          {item.identifier}
        </span>
        <Badge variant={item.completedAt ? 'success' : 'outline'}>
          {item.completedAt ? 'Готово' : 'В работе'}
        </Badge>
        <Badge variant="secondary" title="Сходство по embedding">
          {similarityLabel(item.similarity)}
        </Badge>
        {completed && (
          <span className="text-[11px] text-fg-tertiary">
            Закрыта {completed}
          </span>
        )}
      </div>

      <div className="text-sm text-fg-primary line-clamp-2">{item.title}</div>

      <div className="mt-1 flex items-center justify-end">
        <Link
          href={`/issues/${encodeURIComponent(item.id)}`}
          className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-xs text-fg-secondary transition-colors hover:border-border hover:bg-bg-card hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Посмотреть
          <ArrowUpRight size={12} aria-hidden />
        </Link>
      </div>
    </article>
  );
}
