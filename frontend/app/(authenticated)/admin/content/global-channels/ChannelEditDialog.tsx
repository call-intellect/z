'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminGlobalChannelsApi } from '@/api/admin-global-channels.api';
import type {
  CreateGlobalChannelRequest,
  GlobalChannelItemDomain,
  UpdateGlobalChannelRequest,
} from '@/domain/admin-global-channel';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';

type Props = {
  item: GlobalChannelItemDomain | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSaved: () => void;
};

/**
 * Диалог создания / редактирования глобального Channel.
 *
 * Secrets-handling: `secret` — отдельное поле типа `password`. При создании
 * отправляется всегда (если непусто). При редактировании отправляется
 * ТОЛЬКО при непустом значении — если поле осталось пустым, бэкенд НЕ
 * перетирает существующий секрет (мы просто не включаем поле в PATCH-body).
 *
 * Конфиг без секретов редактируется как JSON-строка. При сохранении
 * парсим — если невалидный JSON, не отправляем и показываем ошибку.
 */
export function ChannelEditDialog({
  item,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const isEdit = item !== null;

  const [kind, setKind] = useState<string>('telegram_bot');
  const [status, setStatus] = useState<string>('active');
  const [direction, setDirection] = useState<string>('inbound_outbound');
  const [configRaw, setConfigRaw] = useState<string>('{}');
  const [secret, setSecret] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSecret('');
    if (item) {
      setKind(item.kind);
      setStatus(item.status);
      setDirection(item.direction);
      // В превью у нас секреты замаскированы — для редактирования это
      // ок, оператор будет редактировать конфиг без секретов и при
      // необходимости обновит secret отдельным полем.
      setConfigRaw(JSON.stringify(item.config, null, 2));
    } else {
      setKind('telegram_bot');
      setStatus('active');
      setDirection('inbound_outbound');
      setConfigRaw('{}');
    }
  }, [open, item]);

  const handleSave = async () => {
    if (saving) return;
    setError(null);

    let configParsed: Record<string, unknown> = {};
    try {
      const raw = configRaw.trim();
      if (raw.length > 0) {
        const parsed = JSON.parse(raw) as unknown;
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed)
        ) {
          throw new Error('Config должен быть JSON-объектом, не массивом.');
        }
        configParsed = parsed as Record<string, unknown>;
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? `Некорректный JSON: ${e.message}`
          : 'Некорректный JSON';
      setError(msg);
      return;
    }

    setSaving(true);
    try {
      if (!isEdit) {
        const body: CreateGlobalChannelRequest = {
          kind,
          status,
          direction,
          config: configParsed,
        };
        if (secret.trim().length > 0) body.secret = secret;
        await adminGlobalChannelsApi.create(body);
        toast.success('Канал создан');
      } else {
        const body: UpdateGlobalChannelRequest = {
          status,
          direction,
          config: configParsed,
        };
        // Секрет включаем в PATCH только если поле непусто — иначе НЕ трогаем.
        if (secret.trim().length > 0) body.secret = secret;
        await adminGlobalChannelsApi.update(item!.id, body);
        toast.success('Канал обновлён');
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось сохранить';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Редактировать канал' : 'Создать глобальный канал'}
          </DialogTitle>
          <DialogDescription>
            На один kind допустима ровно одна глобальная строка. Секреты
            хранятся в config.secrets на бэкенде и не отображаются в превью —
            оставьте поле «Секрет» пустым, чтобы НЕ обновлять его.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ch-kind">Тип канала</Label>
              <Select value={kind} onValueChange={setKind} disabled={isEdit}>
                <SelectTrigger id="ch-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telegram_bot">Telegram бот</SelectItem>
                  <SelectItem value="max_bot">Max бот</SelectItem>
                  <SelectItem value="email_smtp">Email SMTP</SelectItem>
                  <SelectItem value="email_imap">Email IMAP</SelectItem>
                  <SelectItem value="in_app">В приложении</SelectItem>
                </SelectContent>
              </Select>
              {isEdit && (
                <p className="text-[11px] text-fg-tertiary">
                  Тип нельзя поменять — удалите канал и создайте новый.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="ch-status">Статус</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="ch-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активен</SelectItem>
                  <SelectItem value="broken">Сломан</SelectItem>
                  <SelectItem value="disabled">Выключен</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="ch-direction">Направление</Label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger id="ch-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbound">Только входящие</SelectItem>
                  <SelectItem value="outbound">Только исходящие</SelectItem>
                  <SelectItem value="inbound_outbound">Двусторонний</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ch-secret">Секрет (botToken / password)</Label>
            <Input
              id="ch-secret"
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={
                isEdit
                  ? 'Оставьте пустым, чтобы НЕ обновлять'
                  : 'botToken или пароль'
              }
            />
            <p className="text-[11px] text-fg-tertiary">
              В режиме редактирования отправляется только при непустом
              значении. Существующий секрет не виден — бэкенд не возвращает
              его в API.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ch-config">Config (JSON)</Label>
            <Textarea
              id="ch-config"
              value={configRaw}
              onChange={(e) => setConfigRaw(e.target.value)}
              rows={10}
              className="font-mono text-xs"
              placeholder='{"botUsername": "kora_bot"}'
            />
            <p className="text-[11px] text-fg-tertiary">
              Ключи `token` / `secret` / `password` маскируются в превью
              автоматически — но в редакторе они приходят со звёздочками. Не
              храните чувствительные значения в config — для них есть
              отдельное поле «Секрет».
            </p>
          </div>

          {error && (
            <p
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            <Save size={14} />
            {saving ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
