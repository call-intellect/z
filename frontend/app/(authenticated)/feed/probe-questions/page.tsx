import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Вопросы агентов",
};

export default function ProbeQuestionsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
        Вопросы агентов
      </h1>
      <p className="text-sm text-fg-tertiary">
        Агенты Коры задают уточняющие вопросы, чтобы поддержать актуальность
        памяти.
      </p>
      <div className="mt-4 space-y-2 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-8 text-sm text-fg-secondary">
        <p>
          Здесь будут все вопросы Коры. Сейчас они приходят в раздел
          уведомлений, ответ — свободным текстом или голосом, без вариантов на
          выбор.
        </p>
        <Link
          href="/me/notifications"
          className="inline-flex items-center text-accent hover:underline"
        >
          Перейти к уведомлениям
        </Link>
      </div>
    </div>
  );
}
