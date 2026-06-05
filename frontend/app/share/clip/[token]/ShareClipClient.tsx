'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MediaPlayer,
  MediaProvider,
} from '@vidstack/react';
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from '@vidstack/react/player/layouts/default';

import { publicShareApi, type PublicShareClipApi } from '@/api/public-share.api';
import { ApiError } from '@/api/api-error';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Button } from '@/ui/shadcn/button';
import { fmtDurationCompact } from '@/ui/components/meeting-result-v2/format-utils';

type State =
  | { kind: 'loading' }
  | { kind: 'data'; data: PublicShareClipApi }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

export function ShareClipClient({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    publicShareApi
      .getClip(token)
      .then((data) => {
        if (!cancelled) setState({ kind: 'data', data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError) {
          if (e.code === 'http_404' || e.code === 'not_found') {
            setState({ kind: 'not_found' });
            return;
          }
          if (e.code === 'http_410' || e.code === 'expired' || e.code === 'gone') {
            setState({ kind: 'expired' });
            return;
          }
          setState({ kind: 'error', message: e.message });
          return;
        }
        setState({ kind: 'error', message: 'Не удалось загрузить клип' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === 'loading') {
    return (
      <Page>
        <Skeleton className="aspect-video w-full rounded-xl" />
      </Page>
    );
  }
  if (state.kind === 'not_found') {
    return (
      <Page>
        <Center title="Клип не найден" message="Ссылка могла быть удалена." />
      </Page>
    );
  }
  if (state.kind === 'expired') {
    return (
      <Page>
        <Center
          title="Срок ссылки истёк"
          message="Попросите автора прислать новую."
        >
          <Button asChild>
            <Link href="/signup">Зарегистрироваться в Кора</Link>
          </Button>
        </Center>
      </Page>
    );
  }
  if (state.kind === 'error') {
    return (
      <Page>
        <Center title="Ошибка загрузки" message={state.message} />
      </Page>
    );
  }

  const { highlight, videoUrl } = state.data;
  return (
    <Page>
      <header className="mb-4">
        <div className="text-xs uppercase tracking-wider text-fg-tertiary">
          Клип · {fmtDurationCompact(highlight.durationMs)}
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {highlight.title}
        </h1>
      </header>
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-card">
        <MediaPlayer
          title={highlight.title}
          // Явный type: presigned S3-URL (`...mp4?X-Amz-...`) не определяется
          // Vidstack по расширению из-за query → без type плеер виснет без запроса.
          src={{ src: videoUrl, type: 'video/mp4' }}
          autoPlay
          playsInline
          className="aspect-video w-full"
        >
          <MediaProvider />
          <DefaultVideoLayout icons={defaultLayoutIcons} />
        </MediaPlayer>
      </div>
      <footer className="mt-6 text-center text-xs text-fg-tertiary">
        Создано в{' '}
        <Link href="/" className="text-accent hover:text-accent-hover">
          Кора — платформе памяти компании
        </Link>
      </footer>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg-base text-fg-primary">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">{children}</div>
    </main>
  );
}

function Center({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center px-6 py-24 text-center">
      <div className="max-w-md">
        <h2 className="text-xl font-semibold text-fg-primary">{title}</h2>
        <p className="mt-2 text-sm text-fg-secondary">{message}</p>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}
