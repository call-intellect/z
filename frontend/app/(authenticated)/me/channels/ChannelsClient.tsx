'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { Loader2, Link as LinkIcon, Trash2, ExternalLink, RotateCw, Settings2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  generateLinkCode,
  listMyChannels,
  unlinkChannelBinding,
  type ChannelEntryApi,
  type LinkCodeKindApi,
} from '@/api/conversational.api';
import {
  buildTelegramDeepLink,
  resetTelegramBinding,
} from '@/api/me-channels.api';
import { mapChannelEntry } from '@/domain/conversational';
import { mapTelegramChannelEntry } from '@/domain/me-channels';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/ui/components/shared/ConfirmDialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * `/me/channels` — настройка каналов общения с Корой.
 *
 * β-9 / Phase 6 (2026-05-25): для Telegram-канала отдельный рендер с
 * понятными статусами «Привязан»/«Не привязан»/«Бот заблокирован» и
 * двухшаговой перепривязкой (Отвязать → Привязать заново). Кнопка
 * «Открыть @kora_bot» строит deep-link с одноразовым кодом.
 *
 * Для остальных каналов (in_app, max_bot, email_*) сохранён legacy-рендер
 * из α-1.
 */
export function ChannelsClient() {
  const { currentOrgId, isLoading } = useAuth();
  const swrKey = currentOrgId ? ['my-channels', currentOrgId] : null;
  const { data, error, isLoading: loadingList } = useSWR(
    swrKey,
    async () => {
      const res = await listMyChannels(currentOrgId!);
      return res.items;
    },
  );

  const [code, setCode] = useState<{
    kind: LinkCodeKindApi;
    code: string;
    ttlSec: number;
    requestedAt: number;
  } | null>(null);
  const [linkBusy, setLinkBusy] = useState<LinkCodeKindApi | null>(null);
  const [unlinkBusy, setUnlinkBusy] = useState<string | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<string | null>(null);

  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <section className="p-6">
        <p className="text-muted-foreground">
          Этот раздел доступен только в рамках организации.
        </p>
      </section>
    );
  }

  const entries = data ?? [];

  async function handleGenerateCode(kind: LinkCodeKindApi) {
    setLinkBusy(kind);
    try {
      const result = await generateLinkCode(kind);
      setCode({ kind, ...result, requestedAt: Date.now() });
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(`Не удалось сгенерировать код: ${e.message}`);
      }
    } finally {
      setLinkBusy(null);
    }
  }

  function handleUnlink(bindingId: string) {
    setUnlinkTarget(bindingId);
  }

  async function performUnlink() {
    if (!unlinkTarget) return;
    setUnlinkBusy(unlinkTarget);
    try {
      await unlinkChannelBinding(unlinkTarget);
      await mutate(swrKey);
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(`Не удалось отвязать: ${e.message}`);
      }
      throw e;
    } finally {
      setUnlinkBusy(null);
    }
  }

  return (
    <section className="container mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Мои каналы</h1>
        <p className="text-sm text-muted-foreground">
          Через какие каналы Кора может с вами общаться: задавать уточняющие
          вопросы, присылать карточки на модерацию, отвечать на ваш AI-чат.
        </p>
      </header>

      {loadingList && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {error instanceof Error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm">
          Не удалось загрузить каналы: {error.message}
        </div>
      )}

      {!loadingList && entries.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            В этой организации каналы общения ещё не настроены. Канал «В личном
            кабинете» появится автоматически при первом уведомлении.
          </CardContent>
        </Card>
      )}

      <ul className="space-y-3">
        {entries.map((entry) => {
          if (entry.channel.kind === 'telegram_bot') {
            return (
              <li key={entry.channel.id}>
                <TelegramCard
                  entry={entry}
                  onLink={() => handleGenerateCode('telegram_bot')}
                  onUnlink={handleUnlink}
                  onChanged={() => mutate(swrKey)}
                  linkBusy={linkBusy === 'telegram_bot'}
                  unlinkBusy={unlinkBusy}
                />
              </li>
            );
          }
          const ch = mapChannelEntry(entry);
          return (
            <li key={ch.channelId}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {ch.label}
                    <Badge variant={ch.status === 'active' ? 'default' : 'secondary'}>
                      {ch.status === 'active'
                        ? 'Активен'
                        : ch.status === 'disabled'
                          ? 'Выключен'
                          : 'Сломан'}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="text-muted-foreground">
                    Класс данных: до уровня <strong>{ch.maxDataClass}</strong> ·
                    направление: {ch.direction === 'bidirectional' ? 'двустороннее' : ch.direction}
                  </div>
                  {ch.binding ? (
                    <div className="flex items-center justify-between">
                      <div>
                        Привязан: <code className="font-mono">{ch.binding.externalId}</code>
                        {ch.binding.verifiedAt && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            подтверждено {ch.binding.verifiedAt.toLocaleString('ru-RU')}
                          </span>
                        )}
                      </div>
                      {ch.kind !== 'in_app' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnlink(ch.binding!.id)}
                          disabled={unlinkBusy === ch.binding.id}
                        >
                          {unlinkBusy === ch.binding.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          Отвязать
                        </Button>
                      )}
                    </div>
                  ) : ch.kind === 'in_app' ? (
                    <div className="text-xs text-muted-foreground">
                      Канал работает автоматически — отдельной привязки не требует.
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Не привязан. Сгенерируйте код и отправьте боту командой{' '}
                        <code className="font-mono">/link &lt;код&gt;</code>.
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGenerateCode(ch.kind as LinkCodeKindApi)}
                        disabled={linkBusy === ch.kind}
                      >
                        {linkBusy === ch.kind ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <LinkIcon className="mr-2 h-4 w-4" />
                        )}
                        Сгенерировать код
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {code && code.kind !== 'telegram_bot' && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-base">Код для привязки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Канал: <strong>{code.kind}</strong>
            </p>
            <p className="font-mono text-2xl tracking-widest">{code.code}</p>
            <p className="text-xs text-muted-foreground">
              Код действителен {Math.round(code.ttlSec / 60)} мин. Отправьте боту{' '}
              <code className="font-mono">/link {code.code}</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Telegram link dialog (β-9 Phase 6) — выносим в модал, чтобы не
          мешать списку. */}
      <TelegramLinkDialog
        open={!!code && code.kind === 'telegram_bot'}
        onOpenChange={(o) => {
          if (!o) setCode(null);
        }}
        code={code && code.kind === 'telegram_bot' ? code : null}
      />

      <ConfirmDialog
        open={unlinkTarget !== null}
        onOpenChange={(o) => {
          if (!o) setUnlinkTarget(null);
        }}
        title="Отвязать канал?"
        description="Уведомления туда больше не будут приходить."
        confirmLabel="Отвязать"
        destructive
        onConfirm={performUnlink}
      />
    </section>
  );
}

// ─────────────────────────── TelegramCard ─────────────────────────────

function TelegramCard({
  entry,
  onLink,
  onUnlink,
  onChanged,
  linkBusy,
  unlinkBusy,
}: {
  entry: ChannelEntryApi;
  onLink: () => void;
  onUnlink: (bindingId: string) => void;
  onChanged: () => Promise<unknown>;
  linkBusy: boolean;
  unlinkBusy: string | null;
}) {
  const view = mapTelegramChannelEntry(entry);
  const [resetBusy, setResetBusy] = useState(false);

  if (!view) return null;

  const statusVariant: 'default' | 'secondary' | 'warning' | 'danger' =
    view.status === 'linked'
      ? 'default'
      : view.status === 'bot_blocked'
        ? 'warning'
        : view.status === 'channel_disabled'
          ? 'danger'
          : 'secondary';

  async function handleReset() {
    setResetBusy(true);
    try {
      await resetTelegramBinding();
      toast.success('Привязка Telegram сброшена. Привяжите заново.');
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError) {
        if (
          e.code === 'not_implemented' ||
          e.code === 'not_found' ||
          e.message.toLowerCase().includes('not found') ||
          e.message.toLowerCase().includes('cannot post')
        ) {
          toast.error(
            'Перепривязка пока не реализована на сервере. Попросите руководителя сбросить вас через карточку сотрудника.',
          );
        } else {
          toast.error(`Не удалось сбросить: ${e.message}`);
        }
      }
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Telegram
          <Badge variant={statusVariant}>{view.statusLabel}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {view.status === 'channel_disabled' && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
            Глобальный канал Telegram временно выключен главным
            администратором Коры. Сообщения через Telegram не приходят и не
            отправляются. Уведомления продолжают копиться в «Личном
            кабинете» и (если есть) на почте.
          </div>
        )}

        {view.status === 'bot_blocked' && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs">
            Похоже, бот заблокирован у вас в Telegram. Уведомления туда не
            доходят — они копятся во «Входящих» в личном кабинете. Чтобы
            починить: разблокируйте бота и нажмите «Привязать заново».
          </div>
        )}

        {view.binding ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">
                Telegram-идентификатор:
              </span>
              <code className="font-mono">{view.binding.externalId}</code>
              {view.binding.verifiedAt && (
                <span className="text-xs text-muted-foreground">
                  подтверждено{' '}
                  {view.binding.verifiedAt.toLocaleString('ru-RU')}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href="/me/notifications-telegram">
                  <Settings2 className="mr-2 h-4 w-4" />
                  Настроить уведомления
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUnlink(view.binding!.id)}
                disabled={unlinkBusy === view.binding.id}
              >
                {unlinkBusy === view.binding.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Отвязать
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onLink}
                disabled={linkBusy}
              >
                {linkBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCw className="mr-2 h-4 w-4" />
                )}
                Привязать заново
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={resetBusy}
                title="Если потеряли доступ к старому Telegram и не можете отвязать сами"
              >
                {resetBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Сбросить привязку
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              Telegram-бот ещё не привязан к вашему аккаунту. После привязки
              сюда будут приходить задачи, короткие вопросы и упоминания.
            </p>
            <Button onClick={onLink} disabled={linkBusy}>
              {linkBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LinkIcon className="mr-2 h-4 w-4" />
              )}
              Привязать Telegram
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── TelegramLinkDialog ────────────────────────

function TelegramLinkDialog({
  open,
  onOpenChange,
  code,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  code: { code: string; ttlSec: number } | null;
}) {
  if (!code) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const deepLink = buildTelegramDeepLink(code.code);
  const ttlMin = Math.round(code.ttlSec / 60);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code!.code);
      toast.success('Код скопирован.');
    } catch {
      toast.error('Не удалось скопировать. Скопируйте вручную.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Привязать Telegram</DialogTitle>
          <DialogDescription>
            Откройте бота и отправьте ему этот код. Или нажмите «Открыть
            бота» — Telegram сам передаст код.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Одноразовый код
            </div>
            <button
              type="button"
              onClick={copyCode}
              className="block w-full rounded-md border bg-muted px-3 py-3 text-center font-mono text-2xl tracking-widest hover:bg-muted/70"
              title="Скопировать код"
            >
              {code.code}
            </button>
            <p className="mt-1 text-xs text-muted-foreground">
              Код действителен {ttlMin} мин. Нажмите, чтобы скопировать.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          <Button asChild>
            <a href={deepLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Открыть бота
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
