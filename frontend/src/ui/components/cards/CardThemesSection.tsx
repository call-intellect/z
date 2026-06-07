'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { HelpCircle, Sparkles } from 'lucide-react';

import { cardsApi } from '@/api/cards.api';
import {
  THEME_BRANCH_LABELS,
  cardThemeMiniFromApi,
  type CardThemeMiniDomain,
} from '@/domain/theme';

/**
 * Мини-секция «AI обнаружил эти темы» в sidebar карточки.
 *
 * Показывает до 3 тем (бэкенд ограничивает top-3). Если тем нет — секция
 * НЕ рендерится (return null).
 */
export function CardThemesSection({ cardId }: { cardId: string }) {
  const { data } = useSWR(['card-themes', cardId], async () => {
    const res = await cardsApi.listThemes(cardId);
    return res.items.map(cardThemeMiniFromApi);
  });

  const themes = data ?? null;
  if (!themes || themes.length === 0) return null;

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={16} className="text-accent" />
        <h3 className="text-sm font-medium">Кора обнаружила эти темы</h3>
        <span
          className="ml-auto inline-flex text-fg-tertiary"
          title="Темы — это кластеры идей из ваших встреч"
        >
          <HelpCircle size={14} />
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {themes.slice(0, 3).map((t) => (
          <ThemeMiniRow key={t.id} theme={t} />
        ))}
      </ul>
    </div>
  );
}

function ThemeMiniRow({ theme }: { theme: CardThemeMiniDomain }) {
  const branchLabel = theme.branch ? THEME_BRANCH_LABELS[theme.branch] : null;
  return (
    <li>
      <Link
        href={`/themes/${encodeURIComponent(theme.id)}`}
        className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-bg-overlay p-2.5 transition-colors hover:border-accent/60"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="shrink-0 text-accent" />
          <span className="truncate text-sm font-medium text-fg-primary">
            {theme.name}
          </span>
        </div>
        {theme.description && (
          <p className="line-clamp-2 text-xs text-fg-tertiary">
            {theme.description}
          </p>
        )}
        <div className="flex items-center gap-2 text-[11px] text-fg-tertiary">
          {branchLabel && (
            <span className="rounded-full bg-bg-elevated px-1.5 py-0.5">
              {branchLabel}
            </span>
          )}
          <span>{theme.blocksInCommon} общих блоков</span>
        </div>
      </Link>
    </li>
  );
}
