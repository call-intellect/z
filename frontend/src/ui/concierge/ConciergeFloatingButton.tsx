'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';

import { ConciergeChat } from './ConciergeChat';

/**
 * Имя глобального события для программного открытия Concierge с префиллом.
 * Любая страница может вызвать:
 *   window.dispatchEvent(
 *     new CustomEvent('concierge:open', { detail: { prefill: '…' } }),
 *   );
 * (см. кнопку «Спросить Кору» в Таблицах).
 */
export const CONCIERGE_OPEN_EVENT = 'concierge:open';

/**
 * SBA γ-2 — Консьерж (контекстный чат с tool-calling).
 *
 * После объединения помощников (ТЗ-2 Ф3, Р4) собственного плавающего FAB
 * у Консьержа НЕТ — единственная плавающая кнопка кабинета это «Помощник
 * компании» (`AssistantSidebar`). Консьерж открывается только по событию
 * `concierge:open` — например из «Спросить Кору» в Таблицах (создание
 * таблиц/задач словами). Получает текущий `pathname` через `usePathname()`
 * — подмешивается в pageContext.
 */
export function ConciergeFloatingButton() {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const pathname = usePathname();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ prefill?: string }>).detail;
      // Меняем ключ префилла, чтобы повторное открытие гарантированно
      // обновило поле ввода (ConciergeChat реагирует на смену initialInput).
      setPrefill(detail?.prefill ?? '');
      setOpen(true);
    };
    window.addEventListener(CONCIERGE_OPEN_EVENT, handler);
    return () => window.removeEventListener(CONCIERGE_OPEN_EVENT, handler);
  }, []);

  return (
    <>
      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[600px] w-[380px] flex-col rounded-md border border-border-subtle bg-bg-base shadow-2xl">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <div className="text-sm font-medium">Консьерж</div>
            <button
              type="button"
              aria-label="Закрыть"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-fg-tertiary hover:bg-bg-overlay"
            >
              <X size={16} />
            </button>
          </div>
          <ConciergeChat
            pageContext={{ clientPath: pathname ?? undefined }}
            className="flex flex-1 flex-col"
            {...(prefill ? { initialInput: prefill } : {})}
          />
        </div>
      )}
    </>
  );
}
