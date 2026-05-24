import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Спотлайты — Z',
};

export default function SpotlightsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
        Спотлайты
      </h1>
      <p className="text-sm text-fg-tertiary">
        Публичные «спасибо» коллегам.
      </p>
      <div className="mt-4 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
        Появится в Sprint 4.
      </div>
    </div>
  );
}
