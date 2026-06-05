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
import { Clock, ListChecks, MessageCircle, Sparkles } from 'lucide-react';

import { publicShareApi, type PublicShareMeetingApi } from '@/api/public-share.api';
import { ApiError } from '@/api/api-error';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Button } from '@/ui/shadcn/button';
import { Badge } from '@/ui/shadcn/badge';
import { fmtDurationCompact, fmtTime } from '@/ui/components/meeting-result-v2/format-utils';

type State =
  | { kind: 'loading' }
  | { kind: 'data'; data: PublicShareMeetingApi }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

export function ShareMeetingClient({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    publicShareApi
      .getMeeting(token)
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
        setState({ kind: 'error', message: 'Не удалось загрузить ссылку' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === 'loading') {
    return (
      <Page>
        <div className="space-y-4">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-md" />
        </div>
      </Page>
    );
  }
  if (state.kind === 'not_found') {
    return (
      <Page>
        <Center title="Ссылка не найдена" message="Возможно, она была отозвана или скопирована с ошибкой.">
          <Button asChild>
            <Link href="/">На главную Кора</Link>
          </Button>
        </Center>
      </Page>
    );
  }
  if (state.kind === 'expired') {
    return (
      <Page>
        <Center
          title="Срок ссылки истёк"
          message="Попросите автора встречи прислать новую ссылку. Хотите такие же отчёты для своих звонков?"
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

  return <SharedMeetingView data={state.data} />;
}

function SharedMeetingView({ data }: { data: PublicShareMeetingApi }) {
  const m = data.meeting;
  return (
    <Page>
      <header className="mb-5 flex flex-col gap-2">
        <Badge variant="secondary" className="self-start">
          {m.type}
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          {m.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg-secondary">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={12} />
            <span className="font-mono">{fmtDurationCompact(m.durationMs)}</span>
          </span>
          {m.startedAt && (
            <span>{new Date(m.startedAt).toLocaleString('ru-RU')}</span>
          )}
        </div>
      </header>

      {data.permissions.allowVideo && data.videoUrl && (
        <div className="mb-6 overflow-hidden rounded-xl border border-border-subtle bg-bg-card">
          <MediaPlayer
            title={m.title}
            // Явный type: presigned S3-URL (`...mp4?X-Amz-...`) не определяется
            // Vidstack по расширению из-за query → без type плеер виснет без запроса.
            src={{ src: data.videoUrl, type: 'video/mp4' }}
            playsInline
            className="aspect-video w-full"
          >
            <MediaProvider />
            <DefaultVideoLayout icons={defaultLayoutIcons} />
          </MediaPlayer>
        </div>
      )}

      {data.summary && (
        <section className="mb-6 rounded-xl border border-border-subtle bg-bg-card p-5">
          <SectionHeader icon={<Sparkles size={14} />} title="Summary" />
          <p className="m-0 text-sm leading-relaxed text-fg-primary">
            {data.summary}
          </p>
        </section>
      )}

      {data.permissions.allowChapters && data.chapters && data.chapters.length > 0 && (
        <section className="mb-6">
          <SectionHeader title="Главы" />
          <ol className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-bg-card p-3">
            {data.chapters.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 px-2 py-2 text-sm">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-muted font-mono text-[10px] text-accent-fg">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg-primary">{c.title}</span>
                <span className="font-mono text-xs text-fg-tertiary">{fmtTime(c.startMs)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.permissions.allowTasks && data.tasks && data.tasks.length > 0 && (
        <section className="mb-6">
          <SectionHeader icon={<ListChecks size={14} />} title="Action items" />
          <ul className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-bg-card p-3">
            {data.tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-2.5 rounded-md px-3 py-2.5 text-sm"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-fg-tertiary" />
                <div className="min-w-0">
                  <div className="text-fg-primary">{t.title}</div>
                  {(t.assignee || t.dueDate) && (
                    <div className="mt-1 text-xs text-fg-tertiary">
                      {t.assignee && <span className="font-mono">{t.assignee}</span>}
                      {t.assignee && t.dueDate && ' · '}
                      {t.dueDate && <span>до {t.dueDate}</span>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.permissions.allowChat && data.messages && data.messages.length > 0 && (
        <section className="mb-6">
          <SectionHeader icon={<MessageCircle size={14} />} title="Чат встречи" />
          <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-bg-card p-4">
            {groupMessagesByAuthor(data.messages).map((g, i) => (
              <article key={`${g.key}-${i}`} className="flex flex-col gap-1">
                <div className="text-xs font-semibold text-fg-secondary">
                  {g.author}
                </div>
                {g.items.map((m) => (
                  <div key={m.id} className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[10px] text-fg-tertiary">
                      {new Date(m.sentAt).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <p className="m-0 whitespace-pre-wrap break-words text-sm text-fg-primary">
                      {m.content}
                    </p>
                  </div>
                ))}
              </article>
            ))}
          </div>
        </section>
      )}

      {data.permissions.allowTranscript && data.transcript && data.transcript.length > 0 && (
        <section className="mb-6">
          <SectionHeader title="Транскрипт" />
          <div className="rounded-xl border border-border-subtle bg-bg-card p-3">
            {data.transcript.map((u) => (
              <div key={u.id} className="flex items-start gap-3 px-2 py-2">
                <span className="mt-0.5 w-16 shrink-0 font-mono text-xs text-fg-tertiary">
                  {fmtTime(u.startMs)}
                </span>
                <div className="min-w-0 flex-1">
                  {u.speakerName && (
                    <div className="text-xs font-medium text-fg-secondary">
                      {u.speakerName}
                    </div>
                  )}
                  <div className="text-sm text-fg-primary">{u.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-10 flex items-center justify-between rounded-md border border-border-subtle bg-bg-card px-4 py-3">
        <div className="text-xs text-fg-secondary">
          Создано в{' '}
          <Link href="/" className="text-accent hover:text-accent-hover">
            Кора — платформе памяти компании
          </Link>
        </div>
        <Button asChild size="sm">
          <Link href="/signup">Зарегистрироваться</Link>
        </Button>
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

type PublicChatMessage = NonNullable<PublicShareMeetingApi['messages']>[number];

/** Группировка подряд идущих сообщений одного автора. */
function groupMessagesByAuthor(
  messages: PublicChatMessage[],
): Array<{ author: string; key: string; items: PublicChatMessage[] }> {
  const out: Array<{ author: string; key: string; items: PublicChatMessage[] }> = [];
  for (const m of messages) {
    const key = m.authorName;
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.items.push(m);
    } else {
      out.push({ author: m.authorName, key, items: [m] });
    }
  }
  return out;
}

function SectionHeader({ icon, title }: { icon?: React.ReactNode; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      {icon && <span className="text-fg-tertiary">{icon}</span>}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
        {title}
      </h3>
    </div>
  );
}
