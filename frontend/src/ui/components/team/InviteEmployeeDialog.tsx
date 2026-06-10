'use client';

import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { orgsApi, type InviteMemberRequest } from '@/api/orgs.api';
import {
  mapOrgInvitationCreateResultDtoToDomain,
  type OrgInvitationCreateResultDomain,
  type OrgInvitationRole,
} from '@/domain/org-invitations';
import { toast } from 'sonner';
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

type Props = {
  open: boolean;
  orgId: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: OrgInvitationCreateResultDomain) => void;
};

/**
 * β-9 (2026-05-25) — диалог «Пригласить сотрудника» в GitHub-style flow.
 *
 * Поля:
 *   - Имя — обязательное (показывается в карточке pending до accept).
 *   - Роль в системе — «Сотрудник» (manager) по умолчанию / «Администратор» (admin).
 *   - Электронная почта — опциональная. Если пусто — после создания
 *     откроется модал «Скопировать ссылку» с manualShareUrl + QR + linkCode.
 *
 * См. plans/tz/2026-05-25-telegram-bot-global-and-invites.md §2 и §12,
 * second-brain/01_projects/conversational-channels.md §«Продуктовые
 * принципы каналов» (принципы 3 и 4).
 */
export function InviteEmployeeDialog({
  open,
  orgId,
  onOpenChange,
  onCreated,
}: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgInvitationRole>('manager');
  const [submitting, setSubmitting] = useState(false);

  // Сбрасываем поля при открытии/закрытии — чтобы старые данные не «прилипали».
  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setRole('manager');
    }
  }, [open]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Имя сотрудника обязательно');
      return;
    }
    const trimmedEmail = email.trim();
    setSubmitting(true);
    try {
      const body: InviteMemberRequest = {
        name: trimmedName,
        role: role === 'manager' ? 'manager' : 'admin',
      };
      if (trimmedEmail) {
        body.email = trimmedEmail;
      }
      const res = await orgsApi.invite(orgId, body);
      const domain = mapOrgInvitationCreateResultDtoToDomain(res.invitation);
      onCreated(domain);
      // Сообщение зависит от того, ушло ли письмо.
      if (trimmedEmail) {
        toast.success('Приглашение отправлено на электронную почту');
      } else {
        toast.success('Приглашение создано — скопируйте ссылку для сотрудника');
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось создать приглашение');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Пригласить сотрудника</DialogTitle>
          <DialogDescription>
            Сотрудник получит ссылку для входа и подключения Telegram-бота.
            Электронную почту можно не указывать — тогда мы дадим вам ссылку
            для отправки сотруднику вручную. Telegram-бот — личный помощник
            сотрудника: через него Кора присылает чек-ины, напоминания и
            собирает короткие апдейты. Подключение по желанию.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Имя сотрудника</Label>
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, Иван Иванов"
              autoFocus
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-role-dialog">Роль в системе</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as OrgInvitationRole)}
              disabled={submitting}
            >
              <SelectTrigger id="invite-role-dialog">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manager">Сотрудник</SelectItem>
                <SelectItem value="admin">Администратор</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-fg-secondary">
              {role === 'admin'
                ? 'Администратор может приглашать сотрудников и менять настройки компании.'
                : 'Сотрудник видит свои встречи, задачи и переписку с ботом.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-email-dialog">
              Электронная почта{' '}
              <span className="text-xs font-normal text-fg-tertiary">— необязательно</span>
            </Label>
            <Input
              id="invite-email-dialog"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.ru"
              disabled={submitting}
            />
            <p className="text-xs text-fg-secondary">
              Если оставить пустым, вы получите ссылку для отправки
              сотруднику в любом мессенджере.
            </p>
          </div>
        </div>

        <DialogFooter className="sm:gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            {submitting ? 'Создаём…' : 'Отправить приглашение'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
