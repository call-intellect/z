'use client';

/**
 * Wizard загрузки готовой записи (ТЗ-5 Ф5).
 *
 *   Step 1 «Тип»     — галерея типов встречи (как в CreateMeetingFormV2).
 *   Step 2 «Файл»    — dropzone (видео/аудио, до 2 ГБ), название, число говорящих.
 *   Stage «uploading»    — прогресс прямой заливки в S3.
 *   Stage «recognizing»  — поллинг статуса встречи до `awaiting_speakers`.
 *
 * После распознавания — переход на `/meetings/:id/speakers`.
 *
 * Прямая загрузка в S3 идёт В ОБХОД apiClient (`uploadFileToPresignedUrl`),
 * остальное — через слой meetingsApi.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  ClipboardList,
  CloudUpload,
  Headphones,
  Loader2,
  MessageSquare,
  Mic,
  Sparkles,
  Target,
  Users,
  UserSearch,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { meetingsApi, uploadFileToPresignedUrl } from '@/api/meetings.api';
import { ApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { MEETING_TYPES, type MeetingType } from '@/domain/enums';
import { t } from '@/lib/i18n';

import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Textarea } from '@/ui/shadcn/textarea';
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

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 ГБ

/**
 * Расширения, явно перечисленные в ТЗ. Помимо `video/*,audio/*` некоторые
 * браузеры/контейнеры не отдают корректный MIME (mkv/ts/amr/opus), поэтому
 * добавляем расширения в `accept` и в клиентскую проверку формата.
 */
const VIDEO_EXTS = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'wmv',
  'flv',
  '3gp',
  'mpeg',
  'ts',
];
const AUDIO_EXTS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'flac',
  'amr',
  'wma',
];
const ALL_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS];

const ACCEPT_ATTR = [
  'video/*',
  'audio/*',
  ...ALL_EXTS.map((e) => `.${e}`),
].join(',');

function fileExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function isSupportedFile(file: File): boolean {
  if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
    return true;
  }
  return ALL_EXTS.includes(fileExt(file.name));
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

type Stage = 'pick' | 'configure' | 'uploading' | 'recognizing' | 'failed';

export function UploadRecordingWizard() {
  const router = useRouter();
  const { currentOrgId } = useAuth();

  const [stage, setStage] = useState<Stage>('pick');
  const [type, setType] = useState<MeetingType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [speakersMode, setSpeakersMode] = useState<'auto' | 'manual'>('auto');
  const [numSpeakers, setNumSpeakers] = useState('2');
  const [customPrompt, setCustomPrompt] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const onPickType = (tt: MeetingType) => {
    setType(tt);
    setStage('configure');
  };

  const onChooseFile = (incoming: FileList | File[] | null) => {
    const f = incoming ? Array.from(incoming)[0] : null;
    if (!f) return;
    if (!isSupportedFile(f)) {
      toast.error(t('upload.unsupported_format'));
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error(t('upload.too_large'));
      return;
    }
    setFile(f);
    if (!title.trim()) {
      // Префилл названия именем файла без расширения.
      const base = f.name.replace(/\.[^.]+$/, '');
      setTitle(base.slice(0, 200));
    }
  };

  /** Поллинг статуса встречи до `awaiting_speakers` / `failed`. */
  const startPolling = useCallback(
    (orgId: string, meetingId: string) => {
      stopPolling();
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const status = await meetingsApi.resultStatus(meetingId);
            if (status.stage === 'awaiting_speakers') {
              stopPolling();
              router.push(`/meetings/${encodeURIComponent(meetingId)}/speakers`);
            } else if (status.stage === 'failed') {
              stopPolling();
              setErrorText(status.failureReason ?? t('upload.progress_failed'));
              setStage('failed');
            }
          } catch {
            // Сетевые сбои поллинга глотаем — следующий тик повторит.
          }
        })();
      }, 3000);
    },
    [router, stopPolling],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) return;
    if (!currentOrgId) {
      toast.error(t('errors.forbidden'));
      return;
    }
    if (!file) {
      toast.error(t('upload.file_required'));
      return;
    }
    if (!title.trim()) {
      toast.error(t('upload.title_required'));
      return;
    }

    setStage('uploading');
    setProgress(0);
    setErrorText(null);

    let meetingId: string | null = null;
    try {
      const contentType = file.type || 'application/octet-stream';
      const hint =
        speakersMode === 'manual'
          ? Math.max(1, Math.min(50, Number.parseInt(numSpeakers, 10) || 0))
          : null;

      const created = await meetingsApi.createUpload(currentOrgId, {
        type,
        title: title.trim(),
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
        ...(customPrompt.trim() ? { customPrompt: customPrompt.trim() } : {}),
        ...(hint ? { numSpeakersHint: hint } : {}),
      });
      meetingId = created.meetingId;

      abortRef.current = new AbortController();
      await uploadFileToPresignedUrl({
        url: created.uploadUrl,
        file,
        contentType,
        onProgress: (frac) => setProgress(Math.round(frac * 100)),
        signal: abortRef.current.signal,
      });

      await meetingsApi.completeUpload(currentOrgId, meetingId);

      setStage('recognizing');
      startPolling(currentOrgId, meetingId);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      let msg: string;
      switch (code) {
        case 'UPLOAD_DISABLED':
          msg = t('upload.err_disabled');
          break;
        case 'UPLOAD_QUOTA_EXCEEDED':
          msg = t('upload.err_quota');
          break;
        case 'UPLOAD_FILE_TOO_LARGE':
          msg = t('upload.too_large');
          break;
        case 'UPLOAD_UNSUPPORTED_FORMAT':
          msg = t('upload.unsupported_format');
          break;
        default:
          msg = err instanceof ApiError ? err.message : t('upload.err_generic');
      }
      toast.error(msg);
      setErrorText(msg);
      setStage('failed');
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/meetings">
            <ArrowLeft size={14} />
            {t('upload.back')}
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('upload.title')}
          </h1>
          <p className="text-sm text-fg-secondary">
            {stage === 'pick'
              ? t('upload.subtitle_pick')
              : t('upload.subtitle_configure')}
          </p>
        </div>
      </header>

      {stage === 'pick' && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MEETING_TYPES.map((tt, i) => {
            const Icon = TYPE_ICON[tt] ?? Sparkles;
            return (
              <button
                key={tt}
                type="button"
                onClick={() => onPickType(tt)}
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
                  <div className="text-sm font-semibold text-fg-primary">
                    {t(`meeting_types.${tt}.label`)}
                  </div>
                  <div className="mt-1 text-xs text-fg-secondary">
                    {t(`meeting_types.${tt}.description`)}
                  </div>
                </div>
                <span className="ml-auto mt-auto text-xs text-fg-tertiary group-hover:text-accent">
                  {t('upload.choose')} <ArrowRight size={11} className="inline" />
                </span>
              </button>
            );
          })}
        </section>
      )}

      {stage === 'configure' && type && (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-5 rounded-lg border border-border-subtle bg-bg-card p-6"
        >
          <div className="flex items-center gap-3 rounded-md border border-accent-border bg-accent-muted px-4 py-3">
            <Sparkles size={14} className="text-accent" />
            <div className="text-sm">
              {t('upload.pick_hint')}{' '}
              <span className="font-medium text-fg-primary">
                {t(`meeting_types.${type}.label`)}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setStage('pick')}
            >
              {t('upload.change_type')}
            </Button>
          </div>

          {/* Dropzone */}
          <label
            htmlFor="rec-upload"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onChooseFile(e.dataTransfer.files);
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-8 text-center text-sm transition-colors',
              dragOver
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle text-fg-tertiary hover:border-accent/60 hover:text-fg-secondary',
            )}
          >
            <CloudUpload size={22} />
            <span className="font-medium text-fg-secondary">
              {t('upload.drop_zone_main')}
            </span>
            <span className="text-[11px] text-fg-tertiary">
              {t('upload.drop_zone_formats')}
            </span>
            <input
              id="rec-upload"
              type="file"
              className="hidden"
              accept={ACCEPT_ATTR}
              onChange={(e) => {
                onChooseFile(e.target.files);
                e.target.value = '';
              }}
            />
          </label>

          {file && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-fg-primary">
                {file.name}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-fg-tertiary">
                  {fmtBytes(file.size)}
                </span>
                <button
                  type="button"
                  className="text-fg-tertiary hover:text-danger"
                  aria-label={t('upload.remove_file')}
                  onClick={() => setFile(null)}
                >
                  <X size={14} />
                </button>
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-title">{t('upload.meeting_title_label')} *</Label>
            <Input
              id="rec-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('upload.meeting_title_placeholder')}
              required
              maxLength={200}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('upload.num_speakers_label')}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <RadioPill
                active={speakersMode === 'auto'}
                onClick={() => setSpeakersMode('auto')}
                label={t('upload.num_speakers_auto')}
              />
              <RadioPill
                active={speakersMode === 'manual'}
                onClick={() => setSpeakersMode('manual')}
                label={t('upload.num_speakers_manual')}
              />
              {speakersMode === 'manual' && (
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={numSpeakers}
                  onChange={(e) => setNumSpeakers(e.target.value)}
                  className="w-24"
                />
              )}
            </div>
            <p className="text-xs text-fg-tertiary">
              {t('upload.num_speakers_hint')}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-prompt">{t('upload.extra_prompt_label')}</Label>
            <Textarea
              id="rec-prompt"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={4}
              maxLength={10000}
              placeholder={t('upload.extra_prompt_placeholder')}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStage('pick')}
            >
              {t('upload.back')}
            </Button>
            <Button type="submit" disabled={!file || !title.trim()}>
              <CloudUpload size={14} />
              {t('upload.submit')}
            </Button>
          </div>
        </form>
      )}

      {stage === 'uploading' && (
        <div className="rounded-lg border border-border-subtle bg-bg-card p-8">
          <div className="mb-4 flex items-center gap-3">
            <Loader2 className="animate-spin text-accent" size={20} />
            <div className="text-base font-medium text-fg-primary">
              {t('upload.progress_uploading')}
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg-overlay">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 text-right font-mono text-xs text-fg-tertiary">
            {progress}%
          </div>
        </div>
      )}

      {stage === 'recognizing' && (
        <div className="grid place-items-center rounded-lg border border-border-subtle bg-bg-card py-20 text-center">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-accent-muted">
            <Sparkles
              size={20}
              className="animate-pulse text-accent"
              strokeWidth={1.5}
            />
          </div>
          <div className="text-base font-medium text-fg-primary">
            {t('upload.progress_recognizing')}
          </div>
          <div className="mt-1 max-w-sm text-sm text-fg-secondary">
            {t('upload.progress_recognizing_hint')}
          </div>
        </div>
      )}

      {stage === 'failed' && (
        <div className="grid place-items-center rounded-lg border border-border-subtle bg-bg-card py-20 text-center">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-chip-danger-bg">
            <span className="text-xl text-chip-danger-fg">!</span>
          </div>
          <div className="text-base font-medium text-fg-primary">
            {t('upload.progress_failed')}
          </div>
          {errorText && (
            <div className="mt-1 max-w-sm text-sm text-fg-secondary">
              {errorText}
            </div>
          )}
          <Button
            className="mt-5"
            variant="outline"
            onClick={() => {
              setErrorText(null);
              setProgress(0);
              setStage('configure');
            }}
          >
            {t('upload.progress_retry')}
          </Button>
        </div>
      )}
    </div>
  );
}

function RadioPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors',
        active
          ? 'border-accent-border bg-accent-muted text-accent'
          : 'border-border-subtle bg-bg-overlay text-fg-secondary hover:text-fg-primary',
      )}
    >
      <span aria-hidden className="text-[11px]">
        {active ? '◉' : '○'}
      </span>
      {label}
    </button>
  );
}
