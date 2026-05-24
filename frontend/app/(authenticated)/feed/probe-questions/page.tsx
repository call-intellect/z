import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Вопросы агентов — Z',
};

export default function ProbeQuestionsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
        Вопросы агентов
      </h1>
      <p className="text-sm text-fg-tertiary">
        AI-агенты задают уточняющие вопросы, чтобы поддержать актуальность памяти.
      </p>
      <div className="mt-4 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
        Появится в Sprint 5.
      </div>
    </div>
  );
}
