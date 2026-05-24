'use client';

/**
 * MentionAutocompletePopup — popup со списком участников проекта для
 * @-mention'ов в IssueComments (T8).
 *
 * Props:
 *   - members: список участников (см. ProjectMember domain).
 *   - query: текущий введённый после `@` фрагмент (без `@`).
 *   - onSelect: callback при выборе участника. Вставляет в текстовое поле
 *     родителя `@<handle>` (handle = email-local-part или userId).
 *   - onClose: закрыть popup без выбора (Esc/клик вне).
 *
 * Поиск по: displayName (case-insensitive substring) + email-local-part.
 * Если query пустой — показываем первых 8 членов проекта.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  memberDisplayName,
  memberHandle,
  type ProjectMember,
} from '@/domain/tracker';

export interface MentionAutocompletePopupProps {
  members: ProjectMember[];
  query: string;
  onSelect: (member: ProjectMember) => void;
  onClose: () => void;
  /** Опц. id для aria-связки с textarea. */
  inputId?: string;
}

const MAX_VISIBLE = 8;

export function MentionAutocompletePopup({
  members,
  query,
  onSelect,
  onClose,
  inputId,
}: MentionAutocompletePopupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo<ProjectMember[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members.slice(0, MAX_VISIBLE);
    return members
      .filter((m) => {
        const name = memberDisplayName(m).toLowerCase();
        const handle = memberHandle(m).toLowerCase();
        return name.includes(q) || handle.includes(q);
      })
      .slice(0, MAX_VISIBLE);
  }, [members, query]);

  // Сбрасываем активный индекс при изменении фильтра.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, members.length]);

  // Клавиатурная навигация: стрелки + Enter + Esc — обрабатываются
  // родителем через onKeyDown в textarea (popup только подсказывает),
  // но дополнительно слушаем клик-вне для закрытия.
  useEffect(() => {
    const onPointer = (e: PointerEvent): void => {
      if (!containerRef.current) return;
      if (!(e.target instanceof Node)) return;
      if (containerRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [onClose]);

  if (filtered.length === 0) {
    return (
      <div
        ref={containerRef}
        role="listbox"
        aria-labelledby={inputId}
        className="z-50 mt-1 w-64 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-xs text-fg-tertiary shadow-md"
      >
        Никого не найдено
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-labelledby={inputId}
      className="z-50 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-border-subtle bg-bg-elevated py-1 shadow-md"
    >
      {filtered.map((m, idx) => {
        const isActive = idx === activeIndex;
        const name = memberDisplayName(m);
        const handle = memberHandle(m);
        return (
          <button
            key={m.id}
            type="button"
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => setActiveIndex(idx)}
            onClick={() => onSelect(m)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
              isActive
                ? 'bg-accent/10 text-fg-primary'
                : 'text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary'
            }`}
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-bg-overlay text-[10px] font-medium text-fg-tertiary">
              {name.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <span className="shrink-0 text-[11px] text-fg-tertiary">
              @{handle}
            </span>
          </button>
        );
      })}
    </div>
  );
}
