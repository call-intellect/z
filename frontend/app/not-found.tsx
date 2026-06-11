import Link from 'next/link';

export const metadata = {
  title: 'Страница не найдена',
};

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-bg-base px-6 py-8">
      <div className="flex max-w-md flex-col items-center rounded-lg border border-border-subtle bg-bg-card px-8 py-10 text-center">
        <h1 className="mb-2 text-2xl font-semibold text-fg-primary">Страница не найдена</h1>
        <p className="mb-6 text-sm text-fg-tertiary">
          Такой страницы нет или она была перемещена.
        </p>
        <Link
          href="/"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          На главную
        </Link>
      </div>
    </div>
  );
}
