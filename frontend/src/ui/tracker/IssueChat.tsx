'use client';

/**
 * IssueChat — чат-в-задаче (Sprint 5).
 *
 * Phase 2: только заглушка структуры. Реальный live-чат на WebSocket с
 * @-упоминаниями, голосом и AI-ответами появится в Sprint 5.
 */

import { MessageCircle, Clock4 } from 'lucide-react';

export function IssueChat({ issueId: _issueId }: { issueId: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-8 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-bg-overlay">
        <MessageCircle size={18} className="text-fg-tertiary" />
      </div>
      <div className="text-sm font-medium text-fg-primary">
        Чат-в-задаче скоро
      </div>
      <div className="max-w-md text-xs text-fg-tertiary">
        Live-обсуждение прямо в задаче с @-упоминаниями, голосовыми и AI-ответами
        появится в Sprint 5. Сейчас используйте обычные комментарии ниже.
      </div>
      <span className="inline-flex items-center gap-1 text-[11px] text-fg-tertiary">
        <Clock4 size={11} /> Sprint 5
      </span>
    </div>
  );
}
