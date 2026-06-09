'use client';

/**
 * Экран подписи говорящих загруженной записи (ТЗ-5 Ф5).
 *
 * Слева — панель «Говорящие»: по строке на голос (цветная точка, имя, доля
 * времени/реплик, образец речи, действие «Подписать»). Справа — лента
 * «Расшифровка» с цветом говорящего и текущим именем. Снизу — плеер записи.
 *
 * LIVE-REPLACE: редактирование подписи мгновенно меняет state `speakers`
 * (ключ — `label`), а лента и панель деривят отображение из этого state. То
 * есть имя и цвет обновляются во всех репликах ДО подтверждения. Черновик
 * подписей сохраняется debounced-вызовом `putSpeakers`. «Готов» →
 * `confirmSpeakers` → переход на страницу результата.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Loader2,
  UserMinus,
  Users,
} from 'lucide-react';

import {
  meetingsApi,
  type SpeakerAssignmentApi,
  type TranscriptTurn,
} from '@/api/meetings.api';
import { ApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { uploadSpeakerFromApi, type UploadSpeakerUi } from '@/domain/meeting';
import { t } from '@/lib/i18n';

import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Skeleton } from '@/ui/shadcn/skeleton';
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
import { toast } from '@/ui/shadcn/toast';
import { cn } from '@/ui/shadcn/lib/utils';

/** Палитра цветов говорящих на парных chip-токенах (без hex/slate). */
const SPEAKER_PALETTE = [
  { dot: 'bg-chip-info-fg', soft: 'bg-chip-info-bg text-chip-info-fg' },
  { dot: 'bg-chip-success-fg', soft: 'bg-chip-success-bg text-chip-success-fg' },
  { dot: 'bg-chip-lavender-fg', soft: 'bg-chip-lavender-bg text-chip-lavender-fg' },
  { dot: 'bg-chip-warning-fg', soft: 'bg-chip-warning-bg text-chip-warning-fg' },
  { dot: 'bg-chip-sand-fg', soft: 'bg-chip-sand-bg text-chip-sand-fg' },
  { dot: 'bg-chip-danger-fg', soft: 'bg-chip-danger-bg text-chip-danger-fg' },
] as const;

function tn(key: Parameters<typeof t>[0], vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(`{${k}}`, String(v));
  }
  return s;
}

function fmtSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SpeakersScreen({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const { currentOrgId, isLoading: authLoading } = useAuth();

  if (authLoading) return null;
  if (!currentOrgId) {
    return (
      <div className="grid h-[60vh] place-items-center text-sm text-fg-secondary">
        {t('errors.forbidden')}
      </div>
    );
  }
  return <Content meetingId={meetingId} orgId={currentOrgId} router={router} />;
}

function Content({
  meetingId,
  orgId,
  router,
}: {
  meetingId: string;
  orgId: string;
  router: ReturnType<typeof useRouter>;
}) {
  const { data, error, isLoading } = useSWR(
    ['upload-speakers', orgId, meetingId],
    () => meetingsApi.getSpeakers(orgId, meetingId),
    { revalidateOnFocus: false },
  );

  // Локальное состояние говорящих (live-replace). Ключ — label.
  const [speakers, setSpeakers] = useState<UploadSpeakerUi[]>([]);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Инициализация из ответа API.
  useEffect(() => {
    if (!data) return;
    const total = data.speakers.reduce((acc, s) => acc + s.speakingSeconds, 0);
    setSpeakers(data.speakers.map((s) => uploadSpeakerFromApi(s, total)));
    setTurns(data.turns);
  }, [data]);

  // Цвет по label (детерминированно по индексу появления).
  const colorByLabel = useMemo(() => {
    const map = new Map<string, (typeof SPEAKER_PALETTE)[number]>();
    speakers.forEach((s, i) => {
      map.set(s.label, SPEAKER_PALETTE[i % SPEAKER_PALETTE.length]!);
    });
    return map;
  }, [speakers]);

  const speakerByLabel = useMemo(() => {
    const map = new Map<string, UploadSpeakerUi>();
    for (const s of speakers) map.set(s.label, s);
    return map;
  }, [speakers]);

  /** Сохранить черновик подписей (debounced). */
  const scheduleSave = useCallback(
    (next: UploadSpeakerUi[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          try {
            await meetingsApi.putSpeakers(
              orgId,
              meetingId,
              next.map((s) => ({
                label: s.label,
                assignment: s.assignment,
                personId: s.personId,
                externalName: s.externalName,
                externalCompany: s.externalCompany,
                externalPosition: s.externalPosition,
                mergedIntoLabel: s.mergedIntoLabel,
              })),
            );
          } catch (e) {
            toast.error(
              e instanceof ApiError ? e.message : t('speakers.save_failed'),
            );
          }
        })();
      }, 600);
    },
    [orgId, meetingId],
  );

  /** Обновить одного говорящего + запланировать сохранение. */
  const updateSpeaker = useCallback(
    (label: string, patch: Partial<UploadSpeakerUi>) => {
      setSpeakers((prev) => {
        const next = prev.map((s) => {
          if (s.label !== label) return s;
          const merged = { ...s, ...patch };
          // displayLabel деривим из подписи для live-replace в ленте.
          merged.displayLabel = deriveDisplayLabel(merged, prev);
          return merged;
        });
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  // «Готов» доступен, когда ни один звучавший говорящий не остался без подписи.
  const signedCount = useMemo(
    () => speakers.filter((s) => s.hasSpeech && s.assignment !== 'unassigned').length,
    [speakers],
  );
  const totalToSign = useMemo(
    () => speakers.filter((s) => s.hasSpeech).length,
    [speakers],
  );
  const canConfirm = totalToSign > 0 && signedCount === totalToSign;

  const onConfirm = async () => {
    if (!canConfirm) {
      toast.error(t('speakers.not_fully_assigned'));
      return;
    }
    setConfirming(true);
    try {
      // На всякий случай дожимаем последний черновик синхронно перед confirm.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await meetingsApi.putSpeakers(
        orgId,
        meetingId,
        speakers.map((s) => ({
          label: s.label,
          assignment: s.assignment,
          personId: s.personId,
          externalName: s.externalName,
          externalCompany: s.externalCompany,
          externalPosition: s.externalPosition,
          mergedIntoLabel: s.mergedIntoLabel,
        })),
      );
      await meetingsApi.confirmSpeakers(orgId, meetingId);
      toast.success(t('speakers.confirm_done'));
      router.push(`/meetings/${encodeURIComponent(meetingId)}/result`);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      const msg =
        code === 'SPEAKERS_NOT_FULLY_ASSIGNED'
          ? t('speakers.not_fully_assigned')
          : e instanceof ApiError
            ? e.message
            : t('speakers.confirm_failed');
      toast.error(msg);
    } finally {
      setConfirming(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <p className="text-sm text-fg-secondary">{t('speakers.load_failed')}</p>
        <Button asChild variant="ghost" className="mt-3">
          <Link href="/meetings">{t('upload.back')}</Link>
        </Button>
      </div>
    );
  }

  // Реплики исключённых говорящих убираем из ленты.
  const visibleTurns = turns.filter((turn) => {
    const sp = speakerByLabel.get(turn.speaker);
    return !sp || sp.assignment !== 'excluded';
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/meetings">
            <ArrowLeft size={14} />
            {t('upload.back')}
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('speakers.title')}
          </h1>
          <p className="text-sm text-fg-secondary">{t('speakers.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-fg-secondary">
            {tn('speakers.signed_progress', {
              signed: signedCount,
              total: totalToSign,
            })}
          </span>
          <Button disabled={!canConfirm || confirming} onClick={() => void onConfirm()}>
            {confirming ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            {t('speakers.ready')}
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Панель говорящих */}
        <aside className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            <Users size={13} />
            {t('speakers.speakers_panel')}
          </div>
          {speakers.map((sp) => (
            <SpeakerCard
              key={sp.label}
              speaker={sp}
              color={colorByLabel.get(sp.label)!}
              allSpeakers={speakers}
              open={openLabel === sp.label}
              orgId={orgId}
              onToggleOpen={() =>
                setOpenLabel((prev) => (prev === sp.label ? null : sp.label))
              }
              onUpdate={(patch) => updateSpeaker(sp.label, patch)}
            />
          ))}
        </aside>

        {/* Лента расшифровки + плеер */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            {t('speakers.transcript_panel')}
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-lg border border-border-subtle bg-bg-card p-4">
            {visibleTurns.length === 0 ? (
              <p className="py-8 text-center text-sm text-fg-tertiary">
                {t('speakers.empty')}
              </p>
            ) : (
              visibleTurns.map((turn, idx) => {
                const sp = speakerByLabel.get(turn.speaker);
                const color = colorByLabel.get(turn.speaker);
                const name = sp?.displayLabel ?? turn.speaker;
                return (
                  <div key={`${turn.speaker}-${turn.startSec}-${idx}`} className="flex gap-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                        color?.dot ?? 'bg-fg-tertiary',
                      )}
                    />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-fg-primary">
                          {name}
                        </span>
                        <span className="font-mono text-[10px] text-fg-tertiary">
                          {fmtSeconds(turn.startSec)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm leading-relaxed text-fg-secondary">
                        {turn.text}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <PlaybackPlayer orgId={orgId} meetingId={meetingId} />
        </section>
      </div>
    </div>
  );
}

/**
 * Вычисляет отображаемое имя говорящего из его подписи. Для `merged` показываем
 * имя того, с кем объединили (если есть), иначе — технический лейбл.
 */
function deriveDisplayLabel(
  sp: UploadSpeakerUi,
  all: UploadSpeakerUi[],
): string {
  switch (sp.assignment) {
    case 'employee':
      return sp.displayLabel && sp.personId ? sp.displayLabel : sp.label;
    case 'external':
      return sp.externalName?.trim() || sp.label;
    case 'merged': {
      const into = all.find((x) => x.label === sp.mergedIntoLabel);
      return into ? into.displayLabel : sp.label;
    }
    case 'excluded':
    case 'unassigned':
    default:
      return sp.label;
  }
}

function SpeakerCard({
  speaker,
  color,
  allSpeakers,
  open,
  orgId,
  onToggleOpen,
  onUpdate,
}: {
  speaker: UploadSpeakerUi;
  color: (typeof SPEAKER_PALETTE)[number];
  allSpeakers: UploadSpeakerUi[];
  open: boolean;
  orgId: string;
  onToggleOpen: () => void;
  onUpdate: (patch: Partial<UploadSpeakerUi>) => void;
}) {
  const isResolved = speaker.assignment !== 'unassigned';
  const isExcluded = speaker.assignment === 'excluded';

  return (
    <div
      className={cn(
        'rounded-lg border bg-bg-card p-3 transition-colors',
        isResolved ? 'border-accent-border/60' : 'border-border-subtle',
        isExcluded && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn('mt-1 h-3 w-3 shrink-0 rounded-full', color.dot)}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg-primary">
            {speaker.displayLabel}
          </div>
          <div className="mt-0.5 text-xs text-fg-tertiary">
            {tn('speakers.replicas', { count: speaker.turnsCount })} ·{' '}
            {tn('speakers.of_time', { percent: speaker.timePercent })}
          </div>
          {speaker.sampleText && (
            <p className="mt-1 line-clamp-2 text-xs italic text-fg-secondary">
              «{speaker.sampleText}»
            </p>
          )}
          {isExcluded && (
            <p className="mt-1 text-[11px] text-chip-warning-fg">
              {t('speakers.excluded_hint')}
            </p>
          )}
          {speaker.assignment === 'merged' && (
            <p className="mt-1 text-[11px] text-fg-tertiary">
              {t('speakers.merged_hint')}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={onToggleOpen}
        >
          {t('speakers.sign')}
          <ChevronDown
            size={12}
            className={cn('transition-transform', open && 'rotate-180')}
          />
        </Button>
      </div>

      {open && (
        <SigningEditor
          speaker={speaker}
          allSpeakers={allSpeakers}
          orgId={orgId}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}

function SigningEditor({
  speaker,
  allSpeakers,
  orgId: _orgId,
  onUpdate,
}: {
  speaker: UploadSpeakerUi;
  allSpeakers: UploadSpeakerUi[];
  orgId: string;
  onUpdate: (patch: Partial<UploadSpeakerUi>) => void;
}) {
  // Текущий выбранный сотрудник для ParticipantPicker (single-select).
  const employeeValue: ParticipantPickerValue[] =
    speaker.assignment === 'employee' && speaker.personId
      ? [
          {
            type: 'person',
            personId: speaker.personId,
            name: speaker.displayLabel,
          },
        ]
      : [];

  const otherSpeakers = allSpeakers.filter(
    (s) => s.label !== speaker.label && s.assignment !== 'merged',
  );

  return (
    <div className="mt-3 space-y-3 border-t border-border-subtle pt-3">
      {/* Сотрудник */}
      <RadioRow
        active={speaker.assignment === 'employee'}
        label={t('speakers.kind_employee')}
        onSelect={() => onUpdate({ assignment: 'employee' })}
      />
      {speaker.assignment === 'employee' && (
        <div className="pl-5">
          <ParticipantPicker
            value={employeeValue}
            onChange={(next) => {
              const v = next[next.length - 1];
              if (!v) {
                onUpdate({ personId: null });
                return;
              }
              // Контракт PUT speakers принимает только `personId`. После дедупа
              // в org-members/search коллега с заведённым Person приходит как
              // `person` (его и привязываем). «Голый» User без Person в этот
              // контракт не ложится — выбираем именно Person.
              if (v.type === 'person') {
                onUpdate({ personId: v.personId, displayLabel: v.name });
              } else {
                onUpdate({ personId: v.userId, displayLabel: v.name });
              }
            }}
            placeholder={t('speakers.employee_picker_placeholder')}
          />
        </div>
      )}

      {/* Внешний */}
      <RadioRow
        active={speaker.assignment === 'external'}
        label={t('speakers.kind_external')}
        onSelect={() => onUpdate({ assignment: 'external' })}
      />
      {speaker.assignment === 'external' && (
        <div className="space-y-2 pl-5">
          <div className="space-y-1">
            <Label className="text-xs">{t('speakers.external_name_label')}</Label>
            <Input
              value={speaker.externalName ?? ''}
              onChange={(e) =>
                onUpdate({ externalName: e.target.value })
              }
              placeholder={t('speakers.external_name_placeholder')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {t('speakers.external_company_label')}
            </Label>
            <Input
              value={speaker.externalCompany ?? ''}
              onChange={(e) => onUpdate({ externalCompany: e.target.value })}
              placeholder={t('speakers.external_company_placeholder')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {t('speakers.external_position_label')}
            </Label>
            <Input
              value={speaker.externalPosition ?? ''}
              onChange={(e) => onUpdate({ externalPosition: e.target.value })}
              placeholder={t('speakers.external_position_placeholder')}
            />
          </div>
        </div>
      )}

      {/* Объединить */}
      <RadioRow
        active={speaker.assignment === 'merged'}
        label={t('speakers.kind_merge')}
        onSelect={() => onUpdate({ assignment: 'merged' })}
      />
      {speaker.assignment === 'merged' && (
        <div className="pl-5">
          <Select
            value={speaker.mergedIntoLabel ?? ''}
            onValueChange={(v) => onUpdate({ mergedIntoLabel: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('speakers.merge_into_placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {otherSpeakers.map((s) => (
                <SelectItem key={s.label} value={s.label}>
                  {s.displayLabel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Исключить */}
      <button
        type="button"
        onClick={() =>
          onUpdate({
            assignment:
              speaker.assignment === 'excluded' ? 'unassigned' : 'excluded',
          })
        }
        className={cn(
          'flex items-center gap-1.5 text-xs transition-colors',
          speaker.assignment === 'excluded'
            ? 'text-chip-warning-fg'
            : 'text-fg-tertiary hover:text-danger',
        )}
      >
        <UserMinus size={13} />
        {speaker.assignment === 'excluded'
          ? t('speakers.excluded_badge')
          : t('speakers.kind_exclude')}
      </button>
    </div>
  );
}

function RadioRow({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="flex w-full items-center gap-2 text-left text-sm"
    >
      <span
        aria-hidden
        className={cn(
          'text-sm',
          active ? 'text-accent' : 'text-fg-tertiary',
        )}
      >
        {active ? '◉' : '○'}
      </span>
      <span className={active ? 'text-fg-primary' : 'text-fg-secondary'}>
        {label}
      </span>
    </button>
  );
}

/** Плеер записи (видео или аудио) под лентой. */
function PlaybackPlayer({
  orgId,
  meetingId,
}: {
  orgId: string;
  meetingId: string;
}) {
  const { data, error } = useSWR(
    ['upload-playback', orgId, meetingId],
    () => meetingsApi.getPlayback(orgId, meetingId),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (error || (data && !data.url)) {
    return (
      <p className="rounded-lg border border-border-subtle bg-bg-card px-4 py-3 text-xs text-fg-tertiary">
        {t('speakers.no_playback')}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-card px-4 py-3 text-xs text-fg-tertiary">
        <Loader2 size={13} className="animate-spin" />
        {t('app.loading')}
      </div>
    );
  }

  if (data.kind === 'video') {
    return (
      <div className="overflow-hidden rounded-lg border border-border-subtle bg-black">
        {/* Нативный <video> (Vidstack в prod-сборке не инициализировался). */}
        <video
          src={data.url}
          controls
          preload="metadata"
          playsInline
          className="aspect-video w-full"
          aria-label={t('speakers.transcript_panel')}
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card p-3">
      {/* Нативный <audio> для аудио-записи. */}
      <audio
        src={data.url}
        controls
        preload="metadata"
        className="w-full"
        aria-label={t('speakers.transcript_panel')}
      />
    </div>
  );
}
