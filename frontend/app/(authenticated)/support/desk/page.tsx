import type { Metadata } from "next";

import { DeskClient } from "./DeskClient";

export const metadata: Metadata = {
  title: "Поддержка — очередь",
};

export default function SupportDeskPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Служба поддержки
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Очередь обращений клиентов. Отвечайте, назначайте и меняйте статусы.
        </p>
      </header>

      <DeskClient />
    </main>
  );
}
