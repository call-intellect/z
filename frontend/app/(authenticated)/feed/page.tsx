import type { Metadata } from 'next';
import { Newspaper } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Лента — Z',
};

export default function FeedPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
          <Newspaper size={18} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
            Единая лента
          </h1>
          <p className="text-sm text-fg-tertiary">
            Активность по всем проектам компании
          </p>
        </div>
      </header>

      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
        Единая лента активности появится в Sprint 4 (трекер Phase 3).
      </div>
    </div>
  );
}
