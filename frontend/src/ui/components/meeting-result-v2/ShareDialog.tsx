'use client';

/**
 * Диалог приватного шеринга встречи. Создаёт share-ссылку
 * с гранулярными правами и сроком, копирует URL в clipboard.
 * Список существующих shares — с кнопкой revoke.
 */

import { useState } from 'react';
import { Copy, Loader2, Trash2 } from 'lucide-react';

import { sharesApi } from '@/api/shares.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
import { useMeetingShares } from '@/hooks/use-meeting-shares';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Separator } from '@/ui/shadcn/separator';
import { toast } from '@/ui/shadcn/toast';

export type ShareDialogProps = {
  meetingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ShareDialog({ meetingId, open, onOpenChange }: ShareDialogProps) {
  const { shares, mutate, isLoading } = useMeetingShares(open ? meetingId : null);
  const [allowVideo, setAllowVideo] = useState(true);
  const [allowTranscript, setAllowTranscript] = useState(true);
  const [allowTasks, setAllowTasks] = useState(true);
  const [allowChapters, setAllowChapters] = useState(true);
  const [allowChat, setAllowChat] = useState(false);
  const [days, setDays] = useState<'1' | '7' | '14'>('7');
  const [creating, setCreating] = useState(false);

  const onCreate = async () => {
    setCreating(true);
    try {
      const share = await sharesApi.createMeetingShare(meetingId, {
        allowVideo,
        allowTranscript,
        allowTasks,
        allowChapters,
        allowChat,
        expirationDays: Number(days) as 1 | 7 | 14,
      });
      try {
        await navigator.clipboard.writeText(share.url);
        toast.success('Ссылка скопирована в буфер обмена');
      } catch {
        toast.success('Ссылка создана');
      }
      void mutate();
    } catch (e) {
      const message =
        humanizeApiError(e, 'Не удалось создать ссылку.');
      toast.error(message);
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (id: string) => {
    try {
      await sharesApi.revoke(id);
      toast.success('Ссылка отозвана');
      void mutate();
    } catch (e) {
      const message =
        humanizeApiError(e, 'Не удалось отозвать ссылку.');
      toast.error(message);
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Поделиться встречей</DialogTitle>
          <DialogDescription>
            Создайте публичную ссылку. Получатель увидит только то, что вы разрешите.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <SwitchRow
              id="share-video"
              label="Видео"
              checked={allowVideo}
              onChange={setAllowVideo}
            />
            <SwitchRow
              id="share-transcript"
              label="Транскрипт"
              checked={allowTranscript}
              onChange={setAllowTranscript}
            />
            <SwitchRow
              id="share-tasks"
              label="Задачи"
              checked={allowTasks}
              onChange={setAllowTasks}
            />
            <SwitchRow
              id="share-chapters"
              label="Главы"
              checked={allowChapters}
              onChange={setAllowChapters}
            />
            <SwitchRow
              id="share-chat"
              label="Чат участников"
              checked={allowChat}
              onChange={setAllowChat}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="share-expiration">Срок действия</Label>
            <Select value={days} onValueChange={(v) => setDays(v as '1' | '7' | '14')}>
              <SelectTrigger id="share-expiration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 день</SelectItem>
                <SelectItem value="7">7 дней</SelectItem>
                <SelectItem value="14">14 дней</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" disabled={creating}>
            {creating && <Loader2 className="animate-spin" size={14} />}
            Создать ссылку
          </Button>
        </form>

        <Separator />

        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            Активные ссылки
          </div>
          {isLoading ? (
            <div className="text-sm text-fg-tertiary">Загрузка...</div>
          ) : shares.length === 0 ? (
            <div className="text-sm text-fg-tertiary">
              Активных ссылок нет. Создайте новую сверху.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shares.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => copyUrl(s.url)}
                    className="min-w-0 flex-1 truncate text-left font-mono text-xs text-fg-secondary hover:text-accent"
                    title={s.url}
                  >
                    {s.url}
                  </button>
                  <span className="shrink-0 text-xs text-fg-tertiary">
                    {s.viewCount} просм.
                  </span>
                  <span className="shrink-0 text-xs text-fg-tertiary">
                    {s.expiresAt
                      ? `до ${s.expiresAt.toLocaleDateString('ru-RU')}`
                      : 'без срока'}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyUrl(s.url)}
                    aria-label="Скопировать"
                    className="grid h-7 w-7 place-items-center rounded text-fg-secondary hover:bg-bg-card hover:text-fg-primary"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRevoke(s.id)}
                    aria-label="Отозвать"
                    className="grid h-7 w-7 place-items-center rounded text-fg-secondary hover:bg-danger/15 hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SwitchRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-overlay px-3 py-2">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
