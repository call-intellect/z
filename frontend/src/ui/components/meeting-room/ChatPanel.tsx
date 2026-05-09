'use client';

import { Chat } from '@livekit/components-react';

import { t } from '@/lib/i18n';

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Правая панель чата. Использует встроенный `<Chat />` из @livekit/components-react,
 * который под капотом ходит через DataChannel. История чата НЕ персистится — это
 * сознательное решение MVP (см. mvp-meeting-flow analysis).
 */
export function ChatPanel({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <aside
      data-lk-theme="default"
      className="flex h-full w-80 flex-col border-l border-slate-700 bg-slate-900 text-slate-100"
    >
      <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {t('room.controls.chat')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="rounded p-1 text-slate-300 hover:bg-slate-700 hover:text-white"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-hidden">
        <Chat />
      </div>
    </aside>
  );
}
