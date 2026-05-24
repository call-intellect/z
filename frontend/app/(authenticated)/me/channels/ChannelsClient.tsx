'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Loader2, Link as LinkIcon, Trash2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  generateLinkCode,
  listMyChannels,
  unlinkChannelBinding,
  type LinkCodeKindApi,
} from '@/api/conversational.api';
import { mapChannelEntry } from '@/domain/conversational';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/ui/components/shared/ConfirmDialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Список каналов компании + статус моей привязки. На α-1 «в живую»
 * виден `in_app` (он создаётся автоматически при первой нотификации).
 * Кнопки «Привязать Telegram/MAX» появятся, когда β-1 настроит каналы
 * Org через `/admin/channels`. В α-1 эти каналы просто не выведутся,
 * пока их нет в БД.
 */
export function ChannelsClient() {
  const { currentOrgId, isLoading } = useAuth();
  const swrKey = currentOrgId ? ['my-channels', currentOrgId] : null;
  const { data, error, isLoading: loadingList } = useSWR(
    swrKey,
    async () => {
      const res = await listMyChannels(currentOrgId!);
      return res.items.map(mapChannelEntry);
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

  const channels = data ?? [];

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

      {!loadingList && channels.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            В этой организации каналы общения ещё не настроены. Канал «В личном
            кабинете» появится автоматически при первом уведомлении.
          </CardContent>
        </Card>
      )}

      <ul className="space-y-3">
        {channels.map((ch) => (
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
        ))}
      </ul>

      {code && (
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
