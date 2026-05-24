'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Forward,
  Loader2,
  Mic,
  MessageCircle,
  Send,
  Sun,
  Sparkles,
  Unlink,
  XCircle,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  generateLinkCode,
  listMyChannels,
  unlinkChannelBinding,
  type ChannelEntryApi,
} from '@/api/conversational.api';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { Button } from '@/ui/shadcn/button';

/**
 * Telegram-бот ConversationalModule (inbound) — onboarding link wizard
 * и быстрая справка по командам.
 *
 *   - GET /api/v1/me/channels — статус привязки (telegram_bot).
 *   - POST /api/v1/me/channels/telegram_bot/link-code → {code, ttlSec}.
 *   - DELETE /api/v1/me/channels/bindings/:bindingId — отвязать.
 *
 * Polling: при показанном коде раз в 3 сек дёргаем listMyChannels,
 * как только появилась binding с verifiedAt — успех.
 */
export function TelegramLinkSection() {
  const { currentOrgId } = useAuth();
  const { addToast } = useToast();

  const [items, setItems] = useState<ChannelEntryApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  // Активный wizard.
  const [code, setCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Username бота берём из public-env (если задан в проде). На dev — fallback.
  const botUsername =
    typeof process !== 'undefined'
      ? (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '')
      : '';

  // ── Load channels ─────────────────────────────────────────────────────────

  const fetchChannels = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await listMyChannels(currentOrgId);
      setItems(res.items);
      setLoadError(null);
      return res.items;
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : 'Не удалось загрузить каналы';
      setLoadError(msg);
      return null;
    }
  }, [currentOrgId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      await fetchChannels();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchChannels]);

  // ── Polling: пока показан код — каждые 3s проверяем статус ───────────────
  useEffect(() => {
    if (!code) return;
    pollTimer.current = setInterval(() => {
      void (async () => {
        const fresh = await fetchChannels();
        if (!fresh) return;
        const telegram = fresh.find(
          (x) => x.channel.kind === 'telegram_bot' && x.binding?.verifiedAt,
        );
        if (telegram) {
          addToast({
            type: 'success',
            message: `Telegram подключён: ${telegram.binding?.externalId ?? ''}`,
          });
          setCode(null);
          setCodeExpiresAt(null);
        }
      })();
    }, 3000);

    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [code, fetchChannels, addToast]);

  // ── Tick: пересчёт «осталось ХХ:ХХ» раз в секунду ───────────────────────
  useEffect(() => {
    if (!code) return;
    tickTimer.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickTimer.current) {
        clearInterval(tickTimer.current);
        tickTimer.current = null;
      }
    };
  }, [code]);

  // ── Auto-expire когда TTL прошёл ─────────────────────────────────────────
  useEffect(() => {
    if (!codeExpiresAt) return;
    if (now > codeExpiresAt) {
      setCode(null);
      setCodeExpiresAt(null);
    }
  }, [now, codeExpiresAt]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { code: newCode, ttlSec } = await generateLinkCode('telegram_bot');
      setCode(newCode);
      setCodeExpiresAt(Date.now() + ttlSec * 1000);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось получить код',
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleUnlink = async (bindingId: string) => {
    if (!confirm('Отключить Telegram? Бот больше не будет принимать ваши сообщения.')) return;
    setUnlinking(true);
    try {
      await unlinkChannelBinding(bindingId);
      addToast({ type: 'success', message: 'Telegram отключён' });
      await fetchChannels();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось отключить',
      });
    } finally {
      setUnlinking(false);
    }
  };

  const handleCopyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`/start ${code}`);
      addToast({ type: 'success', message: 'Команда скопирована' });
    } catch {
      addToast({ type: 'error', message: 'Не удалось скопировать' });
    }
  };

  const handleCancelWizard = () => {
    setCode(null);
    setCodeExpiresAt(null);
  };

  // ── Derived state ────────────────────────────────────────────────────────

  const telegramEntry = items.find((x) => x.channel.kind === 'telegram_bot');
  const isConnected = Boolean(telegramEntry?.binding?.verifiedAt);
  const externalId = telegramEntry?.binding?.externalId ?? '';

  const secondsLeft = codeExpiresAt
    ? Math.max(0, Math.floor((codeExpiresAt - now) / 1000))
    : 0;
  const mm = Math.floor(secondsLeft / 60)
    .toString()
    .padStart(2, '0');
  const ss = (secondsLeft % 60).toString().padStart(2, '0');

  const tgDeepLink =
    botUsername && code
      ? `https://t.me/${botUsername}?start=${encodeURIComponent(code)}`
      : null;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <section className="mb-6 rounded-lg border border-border-subtle bg-bg-card p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-accent-muted text-accent">
            <MessageCircle size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-fg-primary">
              Telegram-бот
            </h2>
            <p className="text-xs text-fg-tertiary">
              Личный канал общения с Корой — задачи голосом, пересылка
              сообщений, утренний дайджест.
            </p>
          </div>
        </div>

        {isConnected && telegramEntry?.binding && (
          <Button
            size="sm"
            variant="ghost"
            disabled={unlinking}
            onClick={() => void handleUnlink(telegramEntry.binding!.id)}
            className="gap-1.5 text-danger hover:text-danger"
          >
            {unlinking ? <Loader2 size={13} className="animate-spin" /> : <Unlink size={13} />}
            Отключить
          </Button>
        )}
      </header>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-fg-tertiary">
          <Loader2 size={13} className="animate-spin" />
          Проверяем статус…
        </div>
      ) : loadError ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          {loadError}
        </div>
      ) : isConnected ? (
        <ConnectedView externalId={externalId} />
      ) : code ? (
        <LinkWizardView
          code={code}
          mm={mm}
          ss={ss}
          botUsername={botUsername}
          tgDeepLink={tgDeepLink}
          onCopy={handleCopyCode}
          onCancel={handleCancelWizard}
        />
      ) : (
        <NotConnectedView
          onConnect={handleGenerate}
          generating={generating}
        />
      )}

      <BotCommandsHelp />
    </section>
  );
}

// ─── Connected ───────────────────────────────────────────────────────────────

function ConnectedView({ externalId }: { externalId: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
      <CheckCircle2 size={16} />
      <span>
        Подключено
        {externalId ? <> · <span className="font-medium">{externalId}</span></> : null}
      </span>
    </div>
  );
}

// ─── Not connected ───────────────────────────────────────────────────────────

function NotConnectedView({
  onConnect,
  generating,
}: {
  onConnect: () => void;
  generating: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border-subtle bg-bg-elevated p-4">
      <p className="text-sm text-fg-secondary">
        Бот ещё не подключён. После подключения вы сможете писать боту задачи
        текстом, голосом или пересылкой — Кора положит их в трекер.
      </p>
      <Button onClick={onConnect} disabled={generating} className="gap-2">
        {generating ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        Подключить Telegram
      </Button>
    </div>
  );
}

// ─── Wizard ─────────────────────────────────────────────────────────────────

function LinkWizardView({
  code,
  mm,
  ss,
  botUsername,
  tgDeepLink,
  onCopy,
  onCancel,
}: {
  code: string;
  mm: string;
  ss: string;
  botUsername: string;
  tgDeepLink: string | null;
  onCopy: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-fg-primary">
          Свяжите аккаунт за 2 минуты
        </div>
        <div className="text-xs text-fg-tertiary">
          Код действует ещё {mm}:{ss}
        </div>
      </div>

      <ol className="flex flex-col gap-2 text-sm text-fg-secondary">
        <li className="flex items-start gap-2">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-fg">
            1
          </span>
          <div className="flex flex-col gap-1">
            <span>
              Откройте Telegram и найдите бота{' '}
              {botUsername ? (
                <span className="font-medium text-fg-primary">@{botUsername}</span>
              ) : (
                <span className="text-fg-tertiary">(имя бота уточните у администратора)</span>
              )}
            </span>
            {tgDeepLink && (
              <a
                href={tgDeepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 self-start rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-xs text-fg-primary hover:bg-bg-overlay"
              >
                <ExternalLink size={12} />
                Открыть бота в Telegram
              </a>
            )}
          </div>
        </li>

        <li className="flex items-start gap-2">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-fg">
            2
          </span>
          <div className="flex flex-col gap-1">
            <span>Отправьте боту команду:</span>
            <div className="flex items-center gap-2">
              <code className="rounded-md border border-border-subtle bg-bg-card px-3 py-1.5 text-sm font-mono text-fg-primary">
                /start {code}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCopy}
                className="gap-1.5"
              >
                <Copy size={12} />
                Скопировать
              </Button>
            </div>
          </div>
        </li>

        <li className="flex items-start gap-2">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-fg">
            3
          </span>
          <span>Бот ответит «Готово» — эта страница обновится автоматически.</span>
        </li>
      </ol>

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2 text-xs text-fg-tertiary">
          <Loader2 size={12} className="animate-spin" />
          Ждём подтверждения от Telegram…
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <XCircle size={13} />
          Отменить
        </Button>
      </div>
    </div>
  );
}

// ─── Help — что умеет бот ───────────────────────────────────────────────────

const COMMANDS: Array<{
  icon: typeof Send;
  title: string;
  example: string;
  hint?: string;
}> = [
  {
    icon: Sparkles,
    title: 'Напишите задачу одной фразой',
    example: '«Завтра созвон с Романом по договору, оформи задачу»',
    hint: 'Кора сама поймёт срок, ответственного и проект.',
  },
  {
    icon: Forward,
    title: 'Перешлите боту сообщение',
    example: 'Пересылка из чата → автоматически создаётся задача с контекстом',
  },
  {
    icon: Mic,
    title: 'Голосовое сообщение → задача',
    example: 'Запишите голосовое — Кора расшифрует и оформит',
    hint: 'Удобно за рулём.',
  },
  {
    icon: MessageCircle,
    title: 'Отвечайте на уведомления',
    example: '«принял», «+1 день», «не сделаю» — прямо реплаем на сообщение бота',
  },
  {
    icon: Sun,
    title: 'Утренний дайджест задач в 9:00',
    example: 'Бот сам пришлёт список дел на день — без логина в кабинет',
  },
];

function BotCommandsHelp() {
  return (
    <details className="mt-4 rounded-md border border-border-subtle bg-bg-elevated">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
        Что умеет Telegram-бот
      </summary>
      <ul className="flex flex-col gap-2 px-3 pb-3 pt-1">
        {COMMANDS.map((cmd, i) => {
          const Icon = cmd.icon;
          return (
            <li
              key={i}
              className="flex items-start gap-2.5 rounded-md bg-bg-card p-2.5"
            >
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-muted text-accent">
                <Icon size={13} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-fg-primary">
                  {cmd.title}
                </div>
                <div className="text-xs italic text-fg-secondary">
                  {cmd.example}
                </div>
                {cmd.hint && (
                  <div className="mt-0.5 text-[11px] text-fg-tertiary">
                    {cmd.hint}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
