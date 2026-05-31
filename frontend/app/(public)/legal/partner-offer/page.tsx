import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Договор оферты партнёрской программы — Кора',
  description: 'Документ готовится. Если ссылка нужна для подписи — обратись в поддержку.',
};

export default function PartnerOfferPage() {
  return (
    <div className="min-h-screen bg-fg-primary py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center text-sm text-accent hover:underline"
        >
          ← На главную
        </Link>

        <h1 className="mb-2 text-4xl font-bold">
          Договор оферты партнёрской программы — Кора
        </h1>
        <p className="mb-8 text-lg text-fg-secondary">
          Документ готовится. Если ссылка нужна для подписи — обратись в поддержку.
        </p>

        <div className="prose prose-invert max-w-none">
          <div className="mb-8 border-b border-accent-border pb-6 text-sm text-fg-secondary">
            <p>Страница в подготовке</p>
          </div>

          <p>
            Текст публичной оферты для партнёрской программы Z (Кора) сейчас готовится
            юридическим отделом и будет опубликован на этой странице.
          </p>

          <p>
            Если ты уже создал партнёрскую ссылку и тебе нужна подписанная копия документа —
            напиши в поддержку:{' '}
            <a href="mailto:info@call-intellect.ru" className="text-accent hover:underline">
              info@call-intellect.ru
            </a>
            , мы пришлём актуальную редакцию.
          </p>

          <div className="rounded-lg border border-accent-border bg-accent-muted p-6">
            <p>
              Программа работает: вознаграждение 20 000 ₽ в месяц за каждого активного клиента,
              выплата 10-го числа каждого месяца автоматически.
            </p>
          </div>
        </div>

        <div className="mt-12 flex gap-4 border-t border-accent-border pt-8">
          <Link
            href="/"
            className="rounded-lg border border-accent-border px-4 py-2 text-sm text-fg-secondary hover:bg-accent-muted"
          >
            ← На главную
          </Link>
          <Link
            href="/referrals"
            className="rounded-lg border border-accent-border px-4 py-2 text-sm text-accent hover:bg-accent-muted"
          >
            Перейти в кабинет партнёра →
          </Link>
        </div>
      </div>
    </div>
  );
}
