'use client';

/**
 * EmptyCloneList — пустые состояния маркетплейса клонов (ТЗ §5.1).
 *
 * Два варианта:
 *   - kind="org_empty"  — в Org вообще нет клонов (ещё не собрался ни один).
 *   - kind="search"     — фильтрация по поисковому запросу ничего не нашла.
 */

import { Bot, SearchX } from 'lucide-react';
import type { ReactElement } from 'react';

export interface EmptyCloneListProps {
  kind: 'org_empty' | 'search';
  searchQuery?: string;
}

export function EmptyCloneList({
  kind,
  searchQuery,
}: EmptyCloneListProps): ReactElement {
  if (kind === 'search') {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-card p-8 text-center">
        <SearchX className="mx-auto mb-3 h-8 w-8 text-fg-tertiary" />
        <p className="text-sm text-fg-primary">
          По запросу «{searchQuery}» ничего не найдено.
        </p>
        <p className="mt-1 text-xs text-fg-tertiary">
          Попробуйте другое название должности.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-border-subtle bg-bg-card p-10 text-center">
      <Bot className="mx-auto mb-3 h-10 w-10 text-fg-tertiary" />
      <p className="text-base text-fg-primary">
        В вашей организации ещё нет клонов должностей.
      </p>
      <p className="mt-2 text-sm text-fg-tertiary">
        Они появятся автоматически, когда в архиве встреч накопится достаточно
        обсуждений по подходу к решениям для каждой должности.
      </p>
    </div>
  );
}
