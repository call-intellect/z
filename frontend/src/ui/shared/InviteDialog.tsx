'use client';

/**
 * InviteDialog — переиспользуемый диалог «Пригласить участников» (Фаза B5).
 *
 * Открывается из деталей встречи (B1) и из тулбара комнаты (B3) кнопкой
 * «Пригласить». Самодостаточен: выбирает участников через общий
 * `ParticipantPicker` (с переключателями каналов доставки) и отправляет их на
 * `POST /meetings/:id/invitees`. Backend host-only и идемпотентен — повторно
 * приглашённые попадают в `skipped`.
 */

import { useState, type JSX } from 'react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { meetingsApi } from '@/api/meetings.api';
import {
  ParticipantPicker,
  type ParticipantPickerValue,
} from '@/ui/shared/ParticipantPicker';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';

export interface InviteDialogProps {
  meetingId: string;
  open: boolean;
  onClose: () => void;
}

export function InviteDialog({
  meetingId,
  open,
  onClose,
}: InviteDialogProps): JSX.Element | null {
  const [invitees, setInvitees] = useState<ParticipantPickerValue[]>([]);
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const handleSend = async () => {
    if (invitees.length === 0) return;
    const payload = invitees.map((v) => ({
      userId: v.type === 'user' ? v.userId : null,
      personId: v.type === 'person' ? v.personId : null,
      email: v.email ?? null,
      sendVia: v.sendVia ?? [],
    }));
    setSending(true);
    try {
      const res = await meetingsApi.addInvitees(meetingId, {
        invitees: payload,
      });
      toast.success(
        res.added > 0
          ? `Приглашения отправлены: ${res.added}`
          : 'Все выбранные уже приглашены',
      );
      setInvitees([]);
      onClose();
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : 'Не удалось отправить приглашения';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Пригласить участников</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-fg-secondary">
          Выберите коллег или внешние контакты и канал — мы отправим ссылку на
          встречу.
        </p>

        <ParticipantPicker
          value={invitees}
          onChange={setInvitees}
          showChannels
        />

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={sending}>
            Отмена
          </Button>
          <Button
            variant="default"
            onClick={() => void handleSend()}
            disabled={sending || invitees.length === 0}
          >
            {sending ? 'Отправка…' : 'Отправить приглашение'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
