'use client';

/**
 * Wizard создания встречи в стиле AI Meeting Workspace.
 *
 *   Step 1: «Шаблон» — галерея карточек (системные типы + юзерские templates).
 *   Step 2: «Параметры» — title, чекбоксы блоков отчёта, customPrompt.
 *
 * После создания — модалка с deep-link встречи.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  ClipboardList,
  Copy,
  ExternalLink,
  FolderKanban,
  Headphones,
  Loader2,
  Lock,
  MessageSquare,
  Mic,
  ShieldAlert,
  Sparkles,
  Target,
  Users,
  UserSearch,
  Video,
} from 'lucide-react';
import useSWR from 'swr';
import type { LucideIcon } from 'lucide-react';

import { cardsApi } from '@/api/cards.api';
import { meetingsApi } from '@/api/meetings.api';
import { templatesApi } from '@/api/templates.api';
import { ApiError } from '@/api/api-error';
import { templateFromApi, type TemplateDomain } from '@/domain/template';
import { MEETING_TYPES, type MeetingType } from '@/domain/enums';
import {
  CLOSED_GROUP_OPTIONS,
  detectConfidentiality,
  type ClosedGroupKind,
} from '@/domain/knowledge-access';
import { t } from '@/lib/i18n';

import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Textarea } from '@/ui/shadcn/textarea';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import {
  ParticipantPicker,
  type ParticipantPickerValue,
} from '@/ui/shared/ParticipantPicker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { toast } from '@/ui/shadcn/toast';
import { cn } from '@/ui/shadcn/lib/utils';

const TYPE_ICON: Record<MeetingType, LucideIcon> = {
  team: Users,
  standup: Mic,
  plan_fact: Target,
  project: Briefcase,
  sales: Headphones,
  custdev: UserSearch,
  partner: MessageSquare,
  interview: ClipboardList,
  customer_success: Sparkles,
};

type TemplateCard =
  | { kind: 'system'; type: MeetingType; label: string; description: string }
  | { kind: 'custom'; template: TemplateDomain };

export function CreateMeetingFormV2() {
  const searchParams = useSearchParams();
  const cardId = searchParams?.get('cardId') ?? null;

  // Если в URL `?cardId=...` — подгружаем имя карточки для UI-чипа.
  const { data: cardData } = useSWR(
    cardId ? ['create-meeting-card', cardId] : null,
    () => (cardId ? cardsApi.get(cardId) : null),
    { revalidateOnFocus: false },
  );

  const { data: templatesData } = useSWR(
    'templates-list',
    () => templatesApi.list(),
    { revalidateOnFocus: false },
  );

  const userTemplates: TemplateDomain[] = useMemo(
    () =>
      templatesData?.items
        ? templatesData.items.filter((tmp) => !tmp.isSystem).map(templateFromApi)
        : [],
    [templatesData],
  );

  const cards: TemplateCard[] = useMemo(() => {
    const sys: TemplateCard[] = MEETING_TYPES.map((type) => ({
      kind: 'system',
      type,
      label: t(`meeting_types.${type}.label`),
      description: t(`meeting_types.${type}.description`),
    }));
    const cus: TemplateCard[] = userTemplates.map((tmpl) => ({
      kind: 'custom',
      template: tmpl,
    }));
    return [...sys, ...cus];
  }, [userTemplates]);

  const [step, setStep] = useState<'pick' | 'configure'>('pick');
  const [selected, setSelected] = useState<TemplateCard | null>(null);
  const [title, setTitle] = useState('');
  const [includeFollowUp, setIncludeFollowUp] = useState(true);
  const [includeTasks, setIncludeTasks] = useState(true);
  const [recordByDefault, setRecordByDefault] = useState(true);
  // ТЗ 2026-06-06 knowledge-access (Ф7) — закрытость встречи. 'none' = открыто.
  const [closedGroupKind, setClosedGroupKind] = useState<ClosedGroupKind | 'none'>(
    'none',
  );
  const [customPrompt, setCustomPrompt] = useState('');
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [invitees, setInvitees] = useState<ParticipantPickerValue[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);

  const onPick = (c: TemplateCard) => {
    setSelected(c);
    setStep('configure');
  };

  const baseType: MeetingType =
    selected?.kind === 'system'
      ? selected.type
      : (selected?.template.baseType ?? 'team');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (!title.trim()) {
      toast.error('Введите название встречи');
      return;
    }
    setSubmitting(true);
    try {
      // Собираем sections-конфиг в customPrompt-tail если кастом-prompt не пуст,
      // иначе передаём как есть. Бэк сам интерпретирует.
      const promptParts: string[] = [];
      if (customPrompt.trim()) promptParts.push(customPrompt.trim());
      if (!includeFollowUp) promptParts.push('[no follow-up email]');
      if (!includeTasks) promptParts.push('[no tasks]');
      const finalPrompt = promptParts.length > 0 ? promptParts.join('\n\n') : null;

      // Приглашённые → invitees-контракт бэка (Фаза 2.1).
      const inviteesPayload = invitees.map((v) => ({
        userId: v.type === 'user' ? v.userId : null,
        personId: v.type === 'person' ? v.personId : null,
        email: v.email ?? null,
        sendVia: v.sendVia ?? [],
      }));

      const result = await meetingsApi.create({
        type: baseType,
        title: title.trim(),
        custom_prompt: finalPrompt,
        record_by_default: recordByDefault,
        ...(selected.kind === 'custom' ? { templateId: selected.template.id } : {}),
        ...(cardId ? { card_id: cardId } : {}),
        ...(inviteesPayload.length > 0 ? { invitees: inviteesPayload } : {}),
        ...(closedGroupKind !== 'none'
          ? { closed_group_kind: closedGroupKind }
          : {}),
      });
      setCreated(result);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Ошибка создания';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/meetings">
            <ArrowLeft size={14} />
            Назад
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Создать встречу</h1>
          <p className="text-sm text-fg-secondary">
            {step === 'pick'
              ? 'Шаг 1 из 2 · Выберите шаблон отчёта'
              : `Шаг 2 из 2 · ${
                  selected?.kind === 'custom' ? selected.template.name : 'Параметры встречи'
                }`}
          </p>
        </div>
        {cardId && (
          <Link
            href={`/cards/${encodeURIComponent(cardId)}`}
            className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20"
            title="Встреча будет привязана к карточке"
          >
            <FolderKanban size={14} />
            Карточка: {cardData?.name ?? '…'}
          </Link>
        )}
      </header>

      {step === 'pick' && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c, i) => {
            const isSystem = c.kind === 'system';
            const type: MeetingType = isSystem ? c.type : c.template.baseType ?? 'team';
            const Icon = TYPE_ICON[type] ?? Sparkles;
            return (
              <button
                key={isSystem ? `sys-${c.type}` : `cus-${c.template.id}`}
                type="button"
                onClick={() => onPick(c)}
                className={cn(
                  'group flex flex-col items-start gap-3 rounded-lg border border-border-subtle bg-bg-card p-5 text-left transition-all',
                  'hover:-translate-y-0.5 hover:border-accent-border hover:shadow-glow-mint',
                )}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
                  <Icon size={18} strokeWidth={1.75} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold text-fg-primary">
                      {isSystem ? c.label : c.template.name}
                    </div>
                    {!isSystem && (
                      <span className="rounded border border-accent-border bg-accent-muted px-1.5 py-0.5 text-[10px] text-accent">
                        Кастомный
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-fg-secondary">
                    {isSystem
                      ? c.description
                      : (c.template.description ?? 'Кастомный шаблон отчёта')}
                  </div>
                </div>
                <span className="ml-auto mt-auto text-xs text-fg-tertiary group-hover:text-accent">
                  Выбрать <ArrowRight size={11} className="inline" />
                </span>
              </button>
            );
          })}
        </section>
      )}

      {step === 'configure' && selected && (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-5 rounded-lg border border-border-subtle bg-bg-card p-6"
        >
          <div className="flex items-center gap-3 rounded-md border border-accent-border bg-accent-muted px-4 py-3">
            <Sparkles size={14} className="text-accent" />
            <div className="text-sm">
              Шаблон:{' '}
              <span className="font-medium text-fg-primary">
                {selected.kind === 'system'
                  ? t(`meeting_types.${selected.type}.label`)
                  : selected.template.name}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setStep('pick')}
            >
              Сменить
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meeting-title">Название встречи *</Label>
            <Input
              id="meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Демо для Acme Corp"
              required
              maxLength={200}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Запись встречи</Label>
            <label className="flex items-start gap-3 rounded-md border border-border-subtle bg-bg-overlay px-4 py-3">
              <Checkbox
                checked={recordByDefault}
                onCheckedChange={(v) => setRecordByDefault(v === true)}
                className="mt-0.5"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
                  <Video size={14} className="text-accent" />
                  Вести запись автоматически
                </div>
                <div className="mt-0.5 text-xs text-fg-tertiary">
                  Запись стартует при входе хоста. Участники не смогут остановить запись вручную.
                </div>
              </div>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="meeting-closed-group">Кто увидит знания встречи</Label>
            <Select
              value={closedGroupKind}
              onValueChange={(v) =>
                setClosedGroupKind(v as ClosedGroupKind | 'none')
              }
            >
              <SelectTrigger id="meeting-closed-group">
                <span className="flex items-center gap-2">
                  <Lock size={14} className="text-fg-tertiary" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                {CLOSED_GROUP_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-fg-tertiary">
              {CLOSED_GROUP_OPTIONS.find((o) => o.value === closedGroupKind)
                ?.hint ?? ''}
            </p>

            <ConfidentialityAdvisory
              meetingType={baseType}
              title={title}
              currentValue={closedGroupKind}
              onApply={(kind) => setClosedGroupKind(kind)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="meeting-invitees">Пригласить сотрудников</Label>
            <ParticipantPicker
              value={invitees}
              onChange={setInvitees}
              placeholder="Найти сотрудника по имени или почте"
              showChannels
            />
            <p className="mt-1 text-xs text-fg-tertiary">
              Выберите коллег из списка. Для каждого отметьте, как отправить
              приглашение — на почту, в Телеграм или оба канала. Если каналы не
              выбраны, приглашение не отправится.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Что включить в отчёт</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <RowItem
                label="Краткое содержание"
                description="Всегда включено"
                disabled
                checked
              />
              <RowItem
                label="Follow-up письмо"
                description="Готовое письмо клиенту"
                checked={includeFollowUp}
                onCheckedChange={setIncludeFollowUp}
              />
              <RowItem
                label="Задачи (action items)"
                description="С таймкодом и assignee"
                checked={includeTasks}
                onCheckedChange={setIncludeTasks}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setShowCustomPrompt((v) => !v)}
              className="self-start text-sm font-medium text-accent hover:text-accent-hover"
              aria-expanded={showCustomPrompt}
            >
              {showCustomPrompt ? '▾' : '▸'} Дополнительный prompt (опционально)
            </button>
            {showCustomPrompt && (
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={5}
                maxLength={10000}
                placeholder="Дополнительные инструкции для AI: на чём акцентировать, какой стиль..."
              />
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep('pick')}
            >
              Назад
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" size={14} />}
              Создать встречу
            </Button>
          </div>
        </form>
      )}

      {created && (
        <CreatedDialog
          open
          id={created.id}
          url={created.url}
          onClose={() => setCreated(null)}
        />
      )}
    </div>
  );
}

/**
 * Advisory-подсказка о конфиденциальности (ТЗ 2026-06-06 knowledge-access, Ф7).
 *
 * Лёгкий клиентский эвристик: по типу встречи или словам-маркерам в заголовке
 * предлагает закрыть доступ. Это ПОДСКАЗКА, не замок — решает человек. Не
 * показывается, если пользователь уже выбрал предлагаемый уровень закрытости.
 */
function ConfidentialityAdvisory({
  meetingType,
  title,
  currentValue,
  onApply,
}: {
  meetingType: MeetingType;
  title: string;
  currentValue: ClosedGroupKind | 'none';
  onApply: (kind: ClosedGroupKind) => void;
}) {
  const hint = detectConfidentiality(meetingType, title);
  // Не навязываем, если человек уже закрыл встречу нужным образом.
  if (!hint.show || currentValue === hint.suggested) return null;

  const suggestedLabel =
    CLOSED_GROUP_OPTIONS.find((o) => o.value === hint.suggested)?.label ??
    'Закрыть доступ';

  return (
    <div className="flex items-start gap-2.5 rounded-md bg-chip-warning-bg px-3 py-2.5 text-chip-warning-fg">
      <ShieldAlert size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-2">
        <p className="text-sm">
          Похоже, встреча конфиденциальная — закрыть доступ? {hint.reason}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onApply(hint.suggested)}
        >
          {`Закрыть: «${suggestedLabel}»`}
        </Button>
      </div>
    </div>
  );
}

function RowItem({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-2 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2',
        disabled && 'opacity-60',
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange?.(v === true)}
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg-primary">{label}</div>
        <div className="text-xs text-fg-tertiary">{description}</div>
      </div>
    </label>
  );
}

function CreatedDialog({
  open,
  id,
  url,
  onClose,
}: {
  open: boolean;
  id: string;
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const lobbyUrl = url || `/m/${id}`;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + lobbyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Встреча создана</DialogTitle>
          <DialogDescription>
            Поделитесь ссылкой с участниками. Гости подключатся без регистрации.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border-subtle bg-bg-overlay px-3 py-2">
          <div className="font-mono text-xs text-fg-secondary">{lobbyUrl}</div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button variant="outline" onClick={onCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Скопировано' : 'Скопировать ссылку'}
          </Button>
          <Button asChild>
            <a href={lobbyUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              Открыть лобби
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
