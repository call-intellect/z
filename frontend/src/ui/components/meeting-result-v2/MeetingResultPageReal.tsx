'use client';

/**
 * Production-версия страницы результата AI-встречи.
 *
 * Использует тот же визуальный язык, что и
 * `__design-reference__/MeetingResultPage.reference.tsx`,
 * но с реальными данными из API:
 *
 *   - useMeeting (детальная встреча + опрос статусов)
 *   - useMeetingChapters / Tasks / Highlights
 *   - useMeetingChat (стейт-машина чата)
 *
 * Layout: 3 колонки. Левый sidebar — глобальный (через AppShell),
 * центральная — плеер + tabs, правая — AI-чат (коллапсируемая).
 *
 * TODO M7: cleanup старого `meeting-result/*`.
 */

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Copy,
  Download,
  Eye,
  ExternalLink,
  Files,
  FileText,
  ListChecks,
  Loader2,
  Lightbulb,
  Lock,
  MessageCircle,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Search,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';

import { meetingsApi } from '@/api/meetings.api';
import { templatesApi } from '@/api/templates.api';
import { chaptersApi } from '@/api/chapters.api';
import { tasksApi } from '@/api/tasks.api';
import { highlightsApi } from '@/api/highlights.api';
import { exportsApi } from '@/api/exports.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
import { useMeeting } from '@/hooks/use-meeting';
import { useMeetingChapters } from '@/hooks/use-meeting-chapters';
import { useMeetingTasks } from '@/hooks/use-meeting-tasks';
import { useMeetingHighlights } from '@/hooks/use-meeting-highlights';
import { useMeetingRoomMessages } from '@/hooks/use-meeting-room-messages';
import { useVideoPlayer } from '@/hooks/use-video-player';

import type { RoomMessageDomain } from '@/domain/room-message';

import { aiResultFromApi, pickPrimarySummary } from '@/domain/ai-result';
import { pickPrimaryChapters } from '@/domain/chapter';
import {
  CLOSED_GROUP_OPTIONS,
  type ClosedGroupKind,
} from '@/domain/knowledge-access';
import type { MeetingDomain } from '@/domain/meeting';
import {
  meetingStatusView,
  visibilityScopeLabel,
  MEETING_TYPE_LABEL_RU,
} from '@/domain/meeting';
import type { MeetingType } from '@/domain/enums';
import { templateFromApi } from '@/domain/template';
import type { TaskDomain } from '@/domain/task';
import { pickPrimaryTasks } from '@/domain/task';

import { MeetingBehaviorSection } from '@/ui/components/behavior-metrics/MeetingBehaviorSection';
import { MeetingQualityScoreSection } from '@/ui/components/quality-score/MeetingQualityScoreSection';

import { Button } from '@/ui/shadcn/button';
import { Badge } from '@/ui/shadcn/badge';
import { Skeleton } from '@/ui/shadcn/skeleton';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/ui/shadcn/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { toast } from '@/ui/shadcn/toast';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { cn } from '@/ui/shadcn/lib/utils';
import { useTour } from '@/ui/tour';

import { FeedbackButton } from './FeedbackButton';
import { MeetingPlayer } from './MeetingPlayer';
import { MeetingChatPanel } from './MeetingChatPanel';
import { MeetingSummaryRender } from './MeetingSummaryRender';
import { ReportsTab } from './ReportsTab';
import { ShareDialog } from './ShareDialog';
import { VisibilityDialog } from './VisibilityDialog';
import { HighlightCreatorDialog } from './HighlightCreatorDialog';
import { fmtTime, fmtDurationCompact } from './format-utils';
import {
  structuredFieldLabel,
  isEmptyStructuredValue,
  StructuredFieldValue,
} from './structured-report';
import { ReportActions } from './ReportActions';
import {
  NextStepsSection,
  collectNextSteps,
  NEXT_STEP_KEYS,
} from './NextStepsSection';

type TabKey =
  | 'overview'
  | 'reports'
  | 'chapters'
  | 'transcript'
  | 'chat'
  | 'tasks';

export type MeetingResultPageRealProps = {
  meetingId: string;
};

export function MeetingResultPageReal({ meetingId }: MeetingResultPageRealProps) {
  // ТЗ 2026-05-27 onboarding-tour — авто-запуск тура «meeting» при первом
  // открытии страницы результата встречи. Если уже завершён/пропущен — no-op.
  useTour('meeting');

  // Базовая встреча.
  const {
    meeting,
    isLoading: meetingLoading,
    mutate: mutateMeeting,
  } = useMeeting(meetingId);

  /**
   * ТЗ-2 Фаза 4 — честный UI обработки. `aiProcessing` истинно, пока встреча
   * НЕ дошла до финального AI-статуса (`ai_ready` / `ai_failed` / `failed`).
   * Пока он истинен — показываем баннер «Отчёт готовится» и держим поллинг.
   *
   * Поллинг самой встречи (а значит — обновление `meeting.status`) обеспечивает
   * внутренний `refreshInterval` хука `useMeeting` на время AI-обработки;
   * здесь же мы поллим SWR результата, чтобы отчёт подтянулся, как только будет
   * готов. Когда статус становится финальным → `aiProcessing=false` →
   * `refreshInterval=0` → поллинг встаёт.
   */
  const aiProcessing =
    !!meeting && !['ai_ready', 'ai_failed', 'failed'].includes(meeting.status);

  // Детальный «result» с aiResult и recording info.
  const {
    data: result,
    isLoading: resultLoading,
    mutate: mutateResult,
  } = useSWR(
    meetingId ? ['meeting-result', meetingId] : null,
    () => meetingsApi.result(meetingId),
    { revalidateOnFocus: false, refreshInterval: aiProcessing ? 15000 : 0 },
  );

  const { chapters, mutate: mutateChapters } = useMeetingChapters(meetingId);
  const { tasks, mutate: mutateTasks } = useMeetingTasks(meetingId);
  const { highlights, mutate: mutateHighlights } = useMeetingHighlights(meetingId);
  const { messages: roomMessages } = useMeetingRoomMessages(meetingId);

  const player = useVideoPlayer();
  const [currentMs, setCurrentMs] = useState(0);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [shareOpen, setShareOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);

  const aiResult = useMemo(
    () => (result?.aiResult ? aiResultFromApi(result.aiResult) : null),
    [result],
  );

  /**
   * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — приоритетная сводка для UI:
   * fast → v2 → legacy. Возвращает `{ markdown, source }` либо `null`.
   */
  const primarySummary = useMemo(
    () => pickPrimarySummary(aiResult),
    [aiResult],
  );

  /**
   * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — приоритетные главы:
   * если есть fast → только fast, иначе v2 + legacy.
   */
  const primaryChapters = useMemo(
    () => pickPrimaryChapters(chapters),
    [chapters],
  );

  /**
   * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — приоритетные задачи:
   * если есть fast → только fast, иначе v2 + legacy + ручные.
   */
  const primaryTasks = useMemo(() => pickPrimaryTasks(tasks), [tasks]);

  // Presigned URL — отдельный endpoint; null-ключ отключает запрос до готовности.
  // Хук должен быть ДО любых early return'ов (Rules of Hooks).
  const isRecordingReady = result?.recording?.hasRecording === true;
  const { data: downloadData } = useSWR(
    isRecordingReady ? ['recording-download', meetingId] : null,
    () => meetingsApi.downloadUrl(meetingId),
    { revalidateOnFocus: false },
  );
  const safeVideoUrl = downloadData?.url ?? null;

  const onSeek = (ms: number) => {
    player.seekTo(ms);
    setCurrentMs(ms);
  };

  // Скелетон — только истинная первичная загрузка (встречи ещё нет).
  if (meetingLoading && !meeting) {
    return <MeetingResultSkeleton />;
  }

  if (!meeting) {
    return (
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <div className="text-base font-medium text-fg-primary">
          Не удалось загрузить встречу
        </div>
        <div className="mt-2 text-sm text-fg-secondary">
          Возможно, у вас нет доступа или встреча была удалена.
        </div>
        <Button asChild className="mt-6">
          <Link href="/meetings">Вернуться к журналу</Link>
        </Button>
      </div>
    );
  }

  // ТЗ-2 Фаза 4 — пока встреча обрабатывается и отчёта ещё нет, показываем
  // честный баннер «Отчёт готовится» вместо бесконечного скелетона/пустоты.
  // Поллинг (refreshInterval выше) сам подтянет отчёт и сменит экран.
  if (aiProcessing && !result) {
    return <ReportProcessingBanner title={meeting.title} />;
  }

  const recording = result?.recording;

  // Длительность в миллисекундах: приоритет — meeting.durationMs, fallback — recording.
  // S6-12: meeting.durationMs может быть 0 (FSM не проставил) при реальной
  // записи — тогда берём длительность из recording, а не показываем «—»/«0м».
  const durationMs =
    meeting.durationMs && meeting.durationMs > 0
      ? meeting.durationMs
      : recording?.durationSeconds
        ? recording.durationSeconds * 1000
        : null;

  return (
    <div className="grid grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:px-8">
      {/* Center column */}
      <div className="flex min-w-0 flex-col gap-5">
        <MeetingHeader
          meeting={meeting}
          durationMs={durationMs}
          onShare={() => setShareOpen(true)}
          onMutateMeeting={() => {
            void mutateMeeting();
            void mutateResult();
          }}
        />

        {/*
         * Развязка записи от AI-статуса: если AI-ветка упала (`ai_failed`) или
         * встреча в `failed`, но запись готова — показываем НЕнавязчивый баннер
         * и НЕ прячем плеер ниже.
         */}
        <AiFailedBanner
          status={meeting.status}
          hasRecording={isRecordingReady}
        />

        <MeetingPlayer
          videoUrl={safeVideoUrl}
          durationMs={durationMs}
          chapters={primaryChapters}
          highlights={highlights}
          playerRef={player.playerRef}
          onTimeUpdate={(ms) => setCurrentMs(ms)}
          title={meeting.title}
        />

        <HighlightsStrip
          highlights={highlights}
          onCreate={() => setHighlightOpen(true)}
          onSeek={onSeek}
          onMutate={mutateHighlights}
        />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="overview" data-tour-target="meeting.ai-report">
              <FileText size={14} strokeWidth={1.75} />
              Обзор
            </TabsTrigger>
            <TabsTrigger value="reports">
              <Files size={14} strokeWidth={1.75} />
              Отчёты
            </TabsTrigger>
            <TabsTrigger value="chapters">
              <Circle size={14} strokeWidth={1.75} />
              Главы
              {primaryChapters.length > 0 && (
                <span className="ml-1 rounded-full bg-bg-overlay px-1.5 py-0.5 font-mono text-[10px] text-fg-tertiary">
                  {primaryChapters.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="transcript" data-tour-target="meeting.transcript">
              <MessageSquareText size={14} strokeWidth={1.75} />
              Транскрипт
            </TabsTrigger>
            <TabsTrigger value="chat">
              <MessageCircle size={14} strokeWidth={1.75} />
              Чат комнаты
              {roomMessages.length > 0 && (
                <span className="ml-1 rounded-full bg-bg-overlay px-1.5 py-0.5 font-mono text-[10px] text-fg-tertiary">
                  {roomMessages.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="tasks" data-tour-target="meeting.tasks">
              <ListChecks size={14} strokeWidth={1.75} />
              Задачи
              {primaryTasks.length > 0 && (
                <span className="ml-1 rounded-full bg-bg-overlay px-1.5 py-0.5 font-mono text-[10px] text-fg-tertiary">
                  {primaryTasks.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <AnimatePresence mode="wait">
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
              >
                <OverviewTab
                  meeting={meeting}
                  durationMs={durationMs}
                  primarySummary={primarySummary}
                  followUpEmail={aiResult?.followUpEmail ?? null}
                  structuredData={aiResult?.structuredData ?? null}
                  customMd={aiResult?.customOutputMd ?? null}
                  chaptersCount={primaryChapters.length}
                  tasksCount={primaryTasks.length}
                  highlightsCount={highlights.length}
                />
                {/*
                 * Zoom-модель (commercial-reliability pack, 2026-05-30, Фаза 3):
                 * хост видит участников встречи и может переименовать гостей
                 * (тех, у кого `isRegisteredUser=false`). Зарегистрированных
                 * нельзя — их имя из User.name.
                 */}
                {result?.participants && (
                  <div className="mt-4">
                    <ParticipantsSection
                      meetingId={meetingId}
                      participants={result.participants}
                      onMutate={() => void mutateResult()}
                    />
                  </div>
                )}
                {/* Фаза A.3 — Кнопка обратной связи 👍/👎 на AI-отчёт. */}
                <div className="mt-4">
                  <FeedbackButton meetingId={meetingId} />
                </div>
                {/* Фаза C — AI-оценка качества встречи (ПОСЛЕ AI-отчёта, ПЕРЕД поведением). Видна только хосту/org-admin: backend возвращает 403 для остальных, секция автоматически скрывается. */}
                <div className="mt-6">
                  <MeetingQualityScoreSection meetingId={meetingId} />
                </div>
                {/* Фаза B — Поведение участников (рядом с summary). */}
                <div className="mt-6">
                  <MeetingBehaviorSection meetingId={meetingId} />
                </div>
              </motion.div>
            </AnimatePresence>
          </TabsContent>

          <TabsContent value="reports">
            <ReportsTab meetingId={meetingId} />
          </TabsContent>

          <TabsContent value="chapters">
            <ChaptersTab
              meetingId={meetingId}
              chapters={primaryChapters}
              onSeek={onSeek}
              onMutate={mutateChapters}
            />
          </TabsContent>

          <TabsContent value="transcript">
            <TranscriptTab meetingId={meetingId} />
          </TabsContent>

          <TabsContent value="chat">
            <RoomChatTab messages={roomMessages} />
          </TabsContent>

          <TabsContent value="tasks">
            <TasksTab
              meetingId={meetingId}
              tasks={primaryTasks}
              onSeek={onSeek}
              onMutate={mutateTasks}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Right column — AI chat */}
      <MeetingChatPanel meetingId={meetingId} onSeek={onSeek} />

      <ShareDialog
        meetingId={meetingId}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
      <HighlightCreatorDialog
        meetingId={meetingId}
        open={highlightOpen}
        onOpenChange={setHighlightOpen}
        durationMs={durationMs}
        initialStartMs={currentMs > 0 ? currentMs : null}
        onCreated={() => void mutateHighlights()}
      />
    </div>
  );
}

// ─────────────── Header ───────────────

function MeetingHeader({
  meeting,
  durationMs,
  onShare,
  onMutateMeeting,
}: {
  meeting: MeetingDomain;
  durationMs: number | null;
  onShare: () => void;
  onMutateMeeting: () => void;
}) {
  const router = useRouter();
  const typeLabel = MEETING_TYPE_LABEL_RU[meeting.type as MeetingType] ?? meeting.type;
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const [visibilityOpen, setVisibilityOpen] = useState(false);

  // Список юзерских и системных шаблонов для regenerate sub-menu.
  const { data: templatesData } = useSWR(
    'templates-list',
    () => templatesApi.list(),
    { revalidateOnFocus: false },
  );
  const templates = useMemo(
    () => (templatesData?.items ? templatesData.items.map(templateFromApi) : []),
    [templatesData],
  );

  const onRegenerate = async (templateId?: string | null) => {
    try {
      await meetingsApi.regenerate(meeting.id, {
        expectedRecapVersion: meeting.recapVersion,
        ...(templateId !== undefined ? { templateId } : {}),
      });
      toast.success('Регенерация запущена');
      onMutateMeeting();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'recap_version_mismatch') {
          toast.error('Кто-то уже перегенерирует встречу. Обновляю...');
          onMutateMeeting();
          return;
        }
        if (e.code === 'quota_exceeded' || e.code === 'http_429') {
          toast.error('Лимит регенераций исчерпан, попробуйте через час.');
          return;
        }
        toast.error(humanizeApiError(e));
        return;
      }
      toast.error('Не удалось запустить регенерацию');
    }
  };

  const onExport = async (format: 'md' | 'docx') => {
    try {
      const job =
        format === 'md'
          ? await exportsApi.meetingMd(meeting.id)
          : await exportsApi.meetingDocx(meeting.id);
      toast.success(
        `Экспорт ${format.toUpperCase()} запущен. Скачать можно будет в /settings/exports.`,
      );
      void job;
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка экспорта');
      toast.error(msg);
    }
  };

  const onDelete = async () => {
    const ok = await ask({
      title: 'Удалить встречу?',
      description: 'Запись будет помечена как удалённая.',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    try {
      await meetingsApi.softDelete(meeting.id);
      toast.success('Встреча удалена');
      router.push('/meetings');
    } catch (e) {
      const msg = humanizeApiError(e, 'Не удалось удалить');
      toast.error(msg);
    }
  };

  // ТЗ 2026-06-06 knowledge-access (Ф7) — пометить закрытость встречи постфактум.
  const onSetClosedGroup = async (value: ClosedGroupKind | 'none') => {
    const label =
      CLOSED_GROUP_OPTIONS.find((o) => o.value === value)?.label ?? '';
    try {
      await meetingsApi.setClosedGroup(
        meeting.id,
        value === 'none' ? null : value,
      );
      toast.success(`Доступ обновлён: ${label}`);
    } catch (e) {
      const msg = humanizeApiError(e, 'Не удалось изменить доступ');
      toast.error(msg);
    }
  };

  return (
    <header className="flex flex-col gap-3 border-b border-border-subtle pb-5">
      <nav className="flex items-center gap-1.5 text-xs text-fg-tertiary">
        <Link href="/meetings" className="hover:text-fg-secondary">
          Встречи
        </Link>
        <span>›</span>
        <span className="text-fg-secondary">{typeLabel}</span>
      </nav>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight text-fg-primary md:text-2xl">
            {meeting.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-secondary">
            <Badge variant="outline" className="border-accent-border bg-accent-muted text-accent">
              {typeLabel}
            </Badge>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={12} strokeWidth={1.75} />
              <span className="font-mono">{fmtDurationCompact(durationMs)}</span>
            </span>
            {meeting.startedAt && (
              <span>{meeting.startedAt.toLocaleString('ru-RU')}</span>
            )}
            <span className="font-mono text-xs text-fg-tertiary">
              v{meeting.recapVersion}
            </span>
            <span className="inline-flex items-center gap-1.5 text-fg-tertiary">
              <Eye size={12} strokeWidth={1.75} />
              Кому видно:{' '}
              <span className="text-fg-secondary">
                {visibilityScopeLabel(meeting.visibilityScope)}
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onShare}>
            <Share2 size={14} strokeWidth={1.75} />
            Поделиться
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                <RefreshCw size={14} strokeWidth={1.75} />
                Регенерировать
                <ChevronDown size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => void onRegenerate()}>
                С тем же шаблоном
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Использовать другой шаблон…</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuLabel>Шаблоны</DropdownMenuLabel>
                  {templates.length === 0 && (
                    <DropdownMenuItem disabled>Нет доступных шаблонов</DropdownMenuItem>
                  )}
                  {templates.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      onSelect={() => void onRegenerate(t.id)}
                    >
                      {t.name}
                      {t.isSystem && (
                        <span className="ml-1 text-[10px] text-fg-tertiary">·system</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Download size={14} strokeWidth={1.75} />
                Скачать
                <ChevronDown size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void onExport('md')}>
                Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onExport('docx')}>
                Word (.docx)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Меню">
                <MoreHorizontal size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link
                  href={`/meetings/${meeting.id}/result?fullplayer=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={14} />
                  Открыть в новой вкладке
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setVisibilityOpen(true)}>
                <Eye size={14} />
                Кому видно
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Lock size={14} />
                  Кто видит знания встречи
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuLabel>Пометить доступ</DropdownMenuLabel>
                  {CLOSED_GROUP_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.value}
                      onSelect={() => void onSetClosedGroup(opt.value)}
                    >
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void onDelete()}
                className="text-danger focus:text-danger"
              >
                <Trash2 size={14} />
                Удалить встречу
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ProcessingBanner meeting={meeting} />
      {confirmDialog}
      <VisibilityDialog
        meetingId={meeting.id}
        open={visibilityOpen}
        onOpenChange={setVisibilityOpen}
        onSaved={onMutateMeeting}
      />
    </header>
  );
}

function ProcessingBanner({ meeting }: { meeting: MeetingDomain }) {
  // Консолидация отчётов (ТЗ 2026-06-11 §1.2.1): главы/задачи теперь делает
  // единый meeting-report-fast, отдельных воркеров chapters/tasks больше нет —
  // их статусы (chaptersStatus/tasksStatus) более не выставляются и убраны из
  // условия (иначе спиннер висел бы вечно). Остаётся embeddingsStatus
  // (transcript-index жив).
  const states = [meeting.embeddingsStatus];
  const inProgress = states.some((s) => s === 'queued' || s === 'processing');
  if (!inProgress) return null;
  return (
    <div className="flex items-center gap-3 rounded-md border border-accent-border bg-accent-muted px-4 py-2.5 text-sm text-accent">
      <Loader2 size={14} className="animate-spin" />
      Кора обрабатывает встречу. Эта страница обновится сама — можно подождать.
    </div>
  );
}

/**
 * Баннер «AI-отчёт не сформирован». Показывается, когда AI-ветка упала, но
 * запись доступна — чтобы не прятать готовое видео и при этом честно сообщить
 * о сбое отчёта.
 *
 *  - `ai_failed`        — упала ТОЛЬКО AI-ветка, запись в порядке.
 *  - `failed` + запись  — та же болезнь: показываем баннер, но НЕ прячем плеер.
 *
 * При `failed` без записи баннер не нужен (там нечего показывать — этим занят
 * отдельный экран ошибки).
 */
function AiFailedBanner({
  status,
  hasRecording,
}: {
  status: MeetingDomain['status'];
  hasRecording: boolean;
}) {
  const view = meetingStatusView(status);
  const shouldShow = view.isAiFailed || (view.isFailed && hasRecording);
  if (!shouldShow) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-chip-warning-bg bg-chip-warning-bg px-4 py-2.5 text-sm text-chip-warning-fg"
    >
      <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <div>
        <div className="font-medium">Отчёт не сформирован</div>
        <div className="mt-0.5 opacity-90">
          Запись встречи готова и доступна ниже. Автоматический отчёт собрать не
          удалось — можно запустить регенерацию вручную.
        </div>
      </div>
    </div>
  );
}

// ─────────────── Highlights strip ───────────────

function HighlightsStrip({
  highlights,
  onCreate,
  onSeek,
  onMutate,
}: {
  highlights: ReturnType<typeof useMeetingHighlights>['highlights'];
  onCreate: () => void;
  onSeek: (ms: number) => void;
  onMutate: () => void;
}) {
  if (highlights.length === 0) {
    return (
      <button
        type="button"
        onClick={onCreate}
        className="flex items-center gap-2 self-start rounded-md border border-dashed border-border bg-transparent px-3 py-2 text-sm text-fg-secondary transition-colors hover:border-accent-border hover:text-accent"
      >
        <Scissors size={14} strokeWidth={1.75} />
        Создать клип из этой встречи
      </button>
    );
  }
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors size={13} className="text-fg-tertiary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            Клипы · {highlights.length}
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onCreate}>
          <Plus size={13} />
          Новый клип
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {highlights.map((h) => (
          <HighlightCard
            key={h.id}
            highlight={h}
            onSeek={onSeek}
            onMutate={onMutate}
          />
        ))}
      </div>
    </section>
  );
}

function HighlightCard({
  highlight,
  onSeek,
  onMutate,
}: {
  highlight: ReturnType<typeof useMeetingHighlights>['highlights'][number];
  onSeek: (ms: number) => void;
  onMutate: () => void;
}) {
  const [downloading, setDownloading] = useState(false);

  const onDownload = async () => {
    setDownloading(true);
    try {
      if (highlight.renderStatus !== 'ready') {
        const res = await highlightsApi.renderMp4(highlight.id);
        if (res.status === 'ready') {
          // ничего, переход дальше через download
        } else {
          toast.success('Рендер MP4 запущен. Скоро появится ссылка для скачивания.');
          onMutate();
          return;
        }
      }
      const dl = await highlightsApi.download(highlight.id);
      window.open(dl.url, '_blank', 'noopener');
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'render_in_progress' || e.code === 'http_409') {
          toast.message('Рендер уже идёт. Попробуйте через минуту.');
          return;
        }
        if (e.code === 'http_429' || e.code === 'quota_exceeded') {
          toast.error('Превышен лимит рендеринга MP4.');
          return;
        }
        toast.error(humanizeApiError(e));
        return;
      }
      toast.error('Ошибка при скачивании');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <article className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-card p-3">
      <button
        type="button"
        onClick={() => onSeek(highlight.startMs)}
        className="flex items-center justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg-primary">
            {highlight.title}
          </div>
          <div className="font-mono text-xs text-fg-tertiary">
            {fmtTime(highlight.startMs)} – {fmtTime(highlight.endMs)} ·{' '}
            {fmtTime(highlight.durationMs)}
          </div>
        </div>
        <Play size={14} className="text-accent" />
      </button>
      <div className="flex items-center gap-2">
        <RenderStatusBadge status={highlight.renderStatus} />
        <Button
          variant="ghost"
          size="sm"
          onClick={onDownload}
          disabled={downloading}
        >
          {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          {highlight.renderStatus === 'ready' ? 'MP4' : 'Запустить рендер'}
        </Button>
      </div>
    </article>
  );
}

function RenderStatusBadge({
  status,
}: {
  status: ReturnType<typeof useMeetingHighlights>['highlights'][number]['renderStatus'];
}) {
  const map: Record<typeof status, { label: string; cls: string }> = {
    none: { label: 'без MP4', cls: 'text-fg-tertiary' },
    queued: { label: 'в очереди', cls: 'text-warning' },
    processing: { label: 'рендер...', cls: 'text-warning' },
    ready: { label: 'MP4 готов', cls: 'text-accent' },
    failed: { label: 'ошибка', cls: 'text-danger' },
  };
  const v = map[status];
  return <span className={cn('font-mono text-[10px] uppercase tracking-wider', v.cls)}>{v.label}</span>;
}

// ─────────────── Tabs ───────────────

function OverviewTab({
  meeting,
  durationMs,
  primarySummary,
  followUpEmail,
  structuredData,
  customMd,
  chaptersCount,
  tasksCount,
  highlightsCount,
}: {
  meeting: MeetingDomain;
  durationMs: number | null;
  /**
   * Результат `pickPrimarySummary`: `{ markdown, source: 'fast'|'legacy' }`
   * либо `null` если ни одного варианта нет.
   */
  primarySummary: { markdown: string; source: 'fast' | 'legacy' } | null;
  followUpEmail: string | null;
  structuredData: unknown;
  customMd: string | null;
  chaptersCount: number;
  tasksCount: number;
  highlightsCount: number;
}) {
  const stats: Array<{ label: string; value: string | number }> = [
    { label: 'Главы', value: chaptersCount },
    { label: 'Задачи', value: tasksCount },
    { label: 'Клипы', value: highlightsCount },
    { label: 'Длительность', value: fmtDurationCompact(durationMs) },
  ];

  /**
   * Ф5а — «следующие шаги» отчёта выносим отдельной секцией с кнопкой «В задачу»
   * (вместо generic-грида StructuredDataCard, где они исключены NEXT_STEP_KEYS).
   */
  const nextSteps = useMemo(
    () => collectNextSteps(structuredData),
    [structuredData],
  );

  /**
   * Волна 4, B1.4 — клиентский протокол. Backend кладёт нейтральный текст для
   * отправки клиенту в `structuredData.client_protocol_md` (markdown-строка).
   * Рендерим его отдельной секцией «Протокол для клиента» (ниже), а из общего
   * generic-грида `StructuredDataCard` ключ исключён, чтобы не дублировать.
   */
  const clientProtocolMd =
    structuredData &&
    typeof structuredData === 'object' &&
    typeof (structuredData as Record<string, unknown>).client_protocol_md ===
      'string'
      ? ((structuredData as Record<string, unknown>)
          .client_protocol_md as string).trim()
      : '';

  return (
    <div className="flex flex-col gap-4">
      <StatsRow stats={stats} />
      {primarySummary && (
        <Card>
          <CardHeader title="Краткое содержание" />
          {/*
           * `fast` и `v2` приходят как markdown. `legacy` исторически приходит
           * как plain-text, но markdown-рендер совместим (отсутствие разметки
           * выглядит как обычный текст).
           */}
          <MeetingSummaryRender markdown={primarySummary.markdown} />
        </Card>
      )}
      {!primarySummary && !customMd && (
        <Card>
          <div className="text-sm text-fg-secondary">
            Кора ещё не сформировала краткое содержание этой встречи.
          </div>
        </Card>
      )}
      {clientProtocolMd ? <ClientProtocolCard markdown={clientProtocolMd} /> : null}
      {nextSteps.length > 0 ? (
        <NextStepsSection meetingId={meeting.id} steps={nextSteps} />
      ) : null}
      {structuredData ? <StructuredDataCard data={structuredData} /> : null}
      {customMd && (
        <Card>
          <CardHeader title="Кастомный отчёт" />
          <pre className="m-0 max-h-[400px] overflow-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-base p-4 font-mono text-xs leading-relaxed text-fg-primary">
            {customMd}
          </pre>
        </Card>
      )}
      {followUpEmail && <FollowUpCard text={followUpEmail} />}
    </div>
  );
}

/** Русская плюрализация: pluralRu(1,'реплика','реплики','реплик') → 'реплика'. */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function StatsRow({ stats }: { stats: Array<{ label: string; value: string | number }> }) {
  return (
    <div
      className="grid gap-px overflow-hidden rounded-xl border border-border-subtle bg-border-subtle"
      style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}
    >
      {stats.map((s) => (
        <div key={s.label} className="bg-bg-card px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
            {s.label}
          </div>
          <div className="mt-1 font-mono text-base font-semibold tabular-nums text-fg-primary">
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Ключи отчёта с отдельным (не-generic) рендером — вынимаются из общего грида. */
const STRUCTURED_SPECIAL_KEYS = new Set([
  'data_quality',
  'churn_risk_quote',
  'ideas',
  'proposals',
  // Волна 4, B1.4 — клиентский протокол рендерится ОТДЕЛЬНОЙ секцией
  // «Протокол для клиента» (ClientProtocolCard) над StructuredDataCard, поэтому
  // из общего generic-грида он исключён, чтобы не дублироваться.
  'client_protocol_md',
  // Ф5а — «следующие шаги» рендерятся отдельной секцией NextStepsSection с
  // кнопкой «В задачу» (над StructuredDataCard), поэтому из generic-грида
  // исключены, чтобы не дублироваться.
  ...NEXT_STEP_KEYS,
]);

/**
 * data_quality (строка) — приглушённый блок-бейдж «Качество данных» ВНЕ грида.
 * Это НЕ оценка качества встречи (QualityScore) — это полнота входных данных отчёта.
 */
function DataQualityBadge({ value }: { value: unknown }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-base px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
        Качество данных
      </div>
      <div className="mt-1 text-sm leading-relaxed text-fg-tertiary">
        <StructuredFieldValue value={value} />
      </div>
      <div className="mt-1 text-[11px] leading-snug text-fg-tertiary">
        Оценка полноты исходных данных отчёта, а не качества самой встречи.
      </div>
    </div>
  );
}

/** churn_risk_quote (строка) — выделенная цитата риска оттока. */
function ChurnRiskQuote({ value }: { value: unknown }) {
  return (
    <Card>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
        Цитата риска оттока
      </div>
      <blockquote className="mt-2 border-l-2 border-chip-warning-fg pl-3 text-sm italic leading-relaxed text-fg-primary">
        <StructuredFieldValue value={value} />
      </blockquote>
    </Card>
  );
}

/** ideas / proposals (массивы) — отдельная секция с лампочкой, отличная от Задач. */
function IdeasSection({ entries }: { entries: Array<[string, unknown]> }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <Card key={k}>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
            <Lightbulb size={12} className="text-chip-warning-fg" />
            {structuredFieldLabel(k)}
          </div>
          <div className="mt-1.5 text-sm leading-relaxed text-fg-primary">
            <StructuredFieldValue value={v} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function StructuredDataCard({ data }: { data: unknown }) {
  const entries = useMemo(() => {
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data as Record<string, unknown>).filter(
      ([, v]) => !isEmptyStructuredValue(v),
    );
  }, [data]);
  if (entries.length === 0) return null;

  const genericEntries = entries.filter(([k]) => !STRUCTURED_SPECIAL_KEYS.has(k));
  const ideasEntries = entries.filter(
    ([k]) => k === 'ideas' || k === 'proposals',
  );
  const dataQuality = entries.find(([k]) => k === 'data_quality');
  const churnQuote = entries.find(([k]) => k === 'churn_risk_quote');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-fg-primary">Обзор</h3>
        <ReportActions output={data} title="Отчёт встречи" />
      </div>
      {genericEntries.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {genericEntries.map(([k, v]) => (
            <Card key={k}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
                {structuredFieldLabel(k)}
              </div>
              <div className="mt-1.5 text-sm leading-relaxed text-fg-primary">
                <StructuredFieldValue value={v} />
              </div>
            </Card>
          ))}
        </div>
      )}
      {ideasEntries.length > 0 && <IdeasSection entries={ideasEntries} />}
      {churnQuote && <ChurnRiskQuote value={churnQuote[1]} />}
      {dataQuality && <DataQualityBadge value={dataQuality[1]} />}
    </div>
  );
}

function FollowUpCard({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };
  return (
    <Card>
      <CardHeader
        title="Follow-up письмо"
        accessory={
          <Button variant="outline" size="sm" onClick={onCopy}>
            <Copy size={12} />
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
        }
      />
      <pre className="m-0 overflow-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-bg-base p-4 font-mono text-xs leading-relaxed text-fg-primary">
        {text}
      </pre>
    </Card>
  );
}

/**
 * Волна 4, B1.4 — клиентский протокол. Нейтральный текст для отправки клиенту
 * (markdown), который backend кладёт в `structuredData.client_protocol_md`.
 * Отдельная секция со своей кнопкой «Скопировать» (по образцу FollowUpCard),
 * markdown-рендер через тот же `MeetingSummaryRender`, что и краткое содержание.
 */
function ClientProtocolCard({ markdown }: { markdown: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };
  return (
    <Card>
      <CardHeader
        title="Протокол для клиента"
        accessory={
          <Button variant="outline" size="sm" onClick={onCopy}>
            <Copy size={12} />
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
        }
      />
      <p className="mb-3 mt-0 text-xs text-fg-tertiary">
        Нейтральный текст для отправки клиенту.
      </p>
      <MeetingSummaryRender markdown={markdown} />
    </Card>
  );
}

function ChaptersTab({
  meetingId,
  chapters,
  onSeek,
  onMutate,
}: {
  meetingId: string;
  chapters: ReturnType<typeof useMeetingChapters>['chapters'];
  onSeek: (ms: number) => void;
  onMutate: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const onRegenerate = async () => {
    try {
      await chaptersApi.regenerate(meetingId);
      toast.success('Регенерация глав запущена');
      onMutate();
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка');
      toast.error(msg);
    }
  };

  const onSaveTitle = async (id: string) => {
    if (!draftTitle.trim()) return;
    try {
      await chaptersApi.update(id, { title: draftTitle.trim() });
      toast.success('Глава обновлена');
      setEditingId(null);
      onMutate();
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка');
      toast.error(msg);
    }
  };

  const onDelete = async (id: string) => {
    const ok = await ask({
      title: 'Удалить главу?',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    try {
      await chaptersApi.remove(id);
      toast.success('Удалено');
      onMutate();
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка');
      toast.error(msg);
    }
  };

  const onAdd = async (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const title = String(fd.get('title') ?? '').trim();
    const startMs = Number(fd.get('startMs') ?? 0);
    const endMs = Number(fd.get('endMs') ?? startMs + 60_000);
    if (!title) return;
    try {
      await chaptersApi.create(meetingId, { title, startMs, endMs });
      toast.success('Глава добавлена');
      setAdding(false);
      onMutate();
      form.reset();
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка');
      toast.error(msg);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => void onRegenerate()}>
          <Sparkles size={13} />
          Перегенерировать главы
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus size={13} />
          Добавить главу
        </Button>
      </div>
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onAdd(e.currentTarget);
          }}
          className="flex flex-wrap items-end gap-2 rounded-md border border-border-subtle bg-bg-card p-3"
        >
          <input
            name="title"
            placeholder="Название"
            className="flex-1 rounded-md border border-border-subtle bg-bg-overlay px-3 py-1.5 text-sm outline-none placeholder:text-fg-tertiary"
            required
          />
          <input
            name="startMs"
            placeholder="start ms"
            type="number"
            className="w-32 rounded-md border border-border-subtle bg-bg-overlay px-3 py-1.5 font-mono text-sm outline-none"
            defaultValue={0}
          />
          <input
            name="endMs"
            placeholder="end ms"
            type="number"
            className="w-32 rounded-md border border-border-subtle bg-bg-overlay px-3 py-1.5 font-mono text-sm outline-none"
            defaultValue={60000}
          />
          <Button type="submit" size="sm">Сохранить</Button>
        </form>
      )}
      {chapters.length === 0 ? (
        <Card>
          <div className="py-6 text-center text-sm text-fg-secondary">
            Глав ещё нет. Запустите автоматическое определение или добавьте вручную.
          </div>
        </Card>
      ) : (
        chapters.map((c) => (
          <article
            key={c.id}
            className="rounded-md border border-border-subtle bg-bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => onSeek(c.startMs)}
                className="w-20 shrink-0 text-left font-mono text-xs text-fg-tertiary hover:text-accent"
              >
                {fmtTime(c.startMs)}
              </button>
              <div className="min-w-0 flex-1">
                {editingId === c.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="flex-1 rounded-md border border-accent-border bg-bg-overlay px-2 py-1 text-sm outline-none"
                    />
                    <Button size="sm" onClick={() => void onSaveTitle(c.id)}>
                      OK
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Отмена
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(c.id);
                      setDraftTitle(c.title);
                    }}
                    className="text-left text-sm font-medium text-fg-primary hover:text-accent"
                  >
                    {c.title}
                  </button>
                )}
                {c.summary && (
                  <p className="mt-1 text-xs text-fg-secondary">{c.summary}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void onDelete(c.id)}
                className="grid h-7 w-7 place-items-center rounded text-fg-secondary hover:bg-danger/15 hover:text-danger"
                aria-label="Удалить"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </article>
        ))
      )}
      {confirmDialog}
    </div>
  );
}

function TranscriptTab({ meetingId }: { meetingId: string }) {
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [copied, setCopied] = useState(false);

  const { data, error, isLoading } = useSWR(
    ['transcript', meetingId],
    () => meetingsApi.transcript(meetingId),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const { data: tracksData } = useSWR(
    meetingId ? ['audio-tracks', meetingId] : null,
    () => meetingsApi.audioTracks(meetingId),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const onCopyTranscript = async () => {
    const turns = data?.turns ?? [];
    if (turns.length === 0) return;
    const text = turns
      .map((t) => `[${formatSec(t.startSec)}] ${t.speaker}: ${t.text}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const seekTo = (sec: number, speaker: string) => {
    const tracks = tracksData?.tracks ?? [];
    const match = tracks.find((t) => t.participantName === speaker);
    const el = match ? audioRefs.current[match.id] : null;
    if (el) {
      el.currentTime = sec;
      void el.play().catch(() => undefined);
    }
  };

  const hasTracks = (tracksData?.tracks?.length ?? 0) > 0;
  const hasTurns = !error && (data?.turns?.length ?? 0) > 0;

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </Card>
    );
  }

  if (!hasTracks && !hasTurns) {
    return (
      <Card>
        <div className="py-6 text-center text-sm text-fg-secondary">
          Транскрипт и аудиодорожки появятся после обработки встречи.
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {hasTracks && (
        <div className="rounded-xl border border-border-subtle bg-bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-fg-primary">
            Аудиодорожки · {tracksData!.tracks.length}{' '}
            {tracksData!.tracks.length === 1 ? 'участник' : 'участника'}
          </h3>
          <div className="flex flex-col gap-3">
            {tracksData!.tracks.map((track) => (
              <div key={track.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                    {track.participantName}
                  </span>
                  <span className="font-mono text-[10px] text-fg-tertiary">
                    {Math.round(track.durationSeconds / 60)} мин
                  </span>
                </div>
                <audio
                  ref={(el) => {
                    audioRefs.current[track.id] = el;
                  }}
                  src={track.url}
                  controls
                  preload="metadata"
                  className="h-8 w-full"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {hasTurns && (
        <div className="rounded-xl border border-border-subtle bg-bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-fg-primary">
              Транскрипт · {data!.turns.length}{' '}
              {pluralRu(data!.turns.length, 'реплика', 'реплики', 'реплик')}
            </h3>
            <div className="flex items-center gap-2">
              {(data!.durationSeconds ?? 0) > 0 && (
                <span className="font-mono text-xs text-fg-tertiary">
                  {(data!.durationSeconds ?? 0) < 60
                    ? '<1 мин'
                    : `${Math.round((data!.durationSeconds ?? 0) / 60)} мин`}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onCopyTranscript}
                aria-label="Скопировать транскрипт"
                title={copied ? 'Скопировано' : 'Скопировать транскрипт'}
              >
                {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-3 max-h-[600px] overflow-y-auto">
            {data!.turns.map((turn, i) => (
              <div key={i} className="flex gap-3">
                <button
                  type="button"
                  onClick={() => seekTo(turn.startSec, turn.speaker)}
                  className={cn(
                    'w-16 shrink-0 pt-0.5 text-left font-mono text-[11px] text-fg-tertiary',
                    hasTracks && 'cursor-pointer hover:text-accent',
                  )}
                  title={hasTracks ? 'Перейти к этому моменту в аудио' : undefined}
                >
                  {formatSec(turn.startSec)}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-accent mb-0.5">
                    {turn.speaker}
                  </div>
                  <p className="m-0 text-sm leading-relaxed text-fg-primary">
                    {turn.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasTurns && hasTracks && (
        <Card>
          <div className="py-4 text-center text-sm text-fg-secondary">
            Транскрипт ещё не готов. Он появится после обработки аудиозаписи.
          </div>
        </Card>
      )}
    </div>
  );
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function TasksTab({
  meetingId,
  tasks,
  onSeek,
  onMutate,
}: {
  meetingId: string;
  tasks: TaskDomain[];
  onSeek: (ms: number) => void;
  onMutate: () => void;
}) {
  const [adding, setAdding] = useState(false);

  const onAdd = async (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const title = String(fd.get('title') ?? '').trim();
    if (!title) return;
    try {
      await tasksApi.create(meetingId, {
        title,
        assigneeRaw: String(fd.get('assignee') ?? '') || null,
      });
      toast.success('Задача добавлена');
      setAdding(false);
      onMutate();
      form.reset();
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка');
      toast.error(msg);
    }
  };

  const onToggleDone = async (task: TaskDomain) => {
    const next = task.status === 'done' ? 'open' : 'done';
    try {
      await tasksApi.update(task.id, { status: next });
      onMutate();
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка');
      toast.error(msg);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      {tasks.length === 0 && !adding && (
        <Card>
          <div className="py-6 text-center text-sm text-fg-secondary">
            Задач пока нет. Кора определит их при следующем анализе или добавьте вручную.
          </div>
        </Card>
      )}

      {tasks.map((t) => (
        <article
          key={t.id}
          className="rounded-md border border-border-subtle bg-bg-card p-4"
        >
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => void onToggleDone(t)}
              className={cn(
                'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
                t.status === 'done'
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-border-strong text-transparent hover:border-accent',
              )}
              aria-label="Отметить выполненной"
            >
              <CheckCircle2 size={12} strokeWidth={3} />
            </button>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'text-sm leading-snug',
                  t.status === 'done' ? 'text-fg-tertiary line-through' : 'text-fg-primary',
                )}
              >
                {t.title}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-tertiary">
                {t.assignee && (
                  <span className="rounded border border-border-subtle bg-bg-base px-2 py-0.5">
                    <span className="font-mono">{t.assignee}</span>
                  </span>
                )}
                {t.dueDate && (
                  <span className="rounded border border-border-subtle bg-bg-base px-2 py-0.5">
                    до {t.dueDate.toLocaleDateString('ru-RU')}
                  </span>
                )}
                {typeof t.confidence === 'number' && (
                  <span className="rounded border border-border-subtle bg-bg-base px-2 py-0.5">
                    Кора · {(t.confidence * 100).toFixed(0)}%
                  </span>
                )}
                {typeof t.sourceStartMs === 'number' && (
                  <button
                    type="button"
                    onClick={() => onSeek(t.sourceStartMs!)}
                    className="rounded border border-accent-border bg-accent-muted px-2 py-0.5 font-mono text-accent hover:bg-accent-muted-strong"
                  >
                    {fmtTime(t.sourceStartMs)} ›
                  </button>
                )}
              </div>
            </div>
          </div>
        </article>
      ))}

      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onAdd(e.currentTarget);
          }}
          className="flex flex-wrap items-end gap-2 rounded-md border border-border-subtle bg-bg-card p-3"
        >
          <input
            name="title"
            placeholder="Описание задачи"
            className="flex-1 rounded-md border border-border-subtle bg-bg-overlay px-3 py-1.5 text-sm outline-none placeholder:text-fg-tertiary"
            required
          />
          <input
            name="assignee"
            placeholder="Кому (опционально)"
            className="w-48 rounded-md border border-border-subtle bg-bg-overlay px-3 py-1.5 text-sm outline-none placeholder:text-fg-tertiary"
          />
          <Button type="submit" size="sm">Сохранить</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
            Отмена
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 self-start rounded-md border border-dashed border-border bg-transparent px-3 py-2 text-sm text-fg-secondary hover:border-accent-border hover:text-accent"
        >
          <Plus size={13} />
          Добавить задачу вручную
        </button>
      )}
    </div>
  );
}

function RoomChatTab({ messages }: { messages: RoomMessageDomain[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.authorName.toLowerCase().includes(q),
    );
  }, [messages, query]);

  // Группировка подряд идущих сообщений одного автора (по `authorIdentity`,
  // fallback — `authorName`).
  const groups = useMemo(() => {
    const out: Array<{ author: string; key: string; items: RoomMessageDomain[] }> = [];
    for (const m of filtered) {
      const groupKey = m.authorIdentity || m.authorName;
      const last = out[out.length - 1];
      if (last && last.key === groupKey) {
        last.items.push(m);
      } else {
        out.push({ author: m.authorName, key: groupKey, items: [m] });
      }
    }
    return out;
  }, [filtered]);

  if (messages.length === 0) {
    return (
      <Card>
        <div className="py-6 text-center text-sm text-fg-secondary">
          Во время встречи никто не писал в чат.
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по сообщениям…"
          className="w-full rounded-md border border-border-subtle bg-bg-card py-2 pl-9 pr-3 text-sm outline-none placeholder:text-fg-tertiary focus:border-accent"
          aria-label="Поиск по чату"
        />
      </div>

      {groups.length === 0 ? (
        <Card>
          <div className="py-6 text-center text-sm text-fg-tertiary">
            Ничего не найдено по запросу «{query}».
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-bg-card p-4">
          {groups.map((g, i) => (
            <article key={`${g.key}-${i}`} className="flex flex-col gap-1">
              <div className="text-xs font-semibold text-fg-secondary">
                {g.author}
              </div>
              {g.items.map((m) => (
                <div
                  key={m.id || m.clientMessageId}
                  className="flex items-baseline gap-2"
                >
                  <span className="shrink-0 font-mono text-[10px] text-fg-tertiary">
                    {m.sentAt.toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <p className="m-0 whitespace-pre-wrap break-words text-sm text-fg-primary">
                    {m.content}
                  </p>
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────── Participants (Zoom-rename) ───────────────

type ParticipantRowDto = {
  id: string;
  name: string;
  role: 'host' | 'guest';
  isRegisteredUser: boolean;
};

/**
 * Список участников встречи. Для хоста — inline-edit имени гостя
 * (`isRegisteredUser=false`). Зарегистрированных не редактируем.
 */
function ParticipantsSection({
  meetingId,
  participants,
  onMutate,
}: {
  meetingId: string;
  participants: ParticipantRowDto[];
  onMutate: () => void;
}) {
  return (
    <Card>
      <CardHeader title="Участники" />
      <ul className="m-0 flex flex-col gap-2 p-0 list-none">
        {participants.map((p) => (
          <ParticipantRow
            key={p.id}
            meetingId={meetingId}
            participant={p}
            onSaved={onMutate}
          />
        ))}
      </ul>
    </Card>
  );
}

function ParticipantRow({
  meetingId,
  participant,
  onSaved,
}: {
  meetingId: string;
  participant: ParticipantRowDto;
  onSaved: () => void;
}) {
  const canEdit = !participant.isRegisteredUser;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(participant.name);
  const [saving, setSaving] = useState(false);

  const onStart = () => {
    setDraft(participant.name);
    setEditing(true);
  };

  const onCancel = () => {
    setEditing(false);
    setDraft(participant.name);
  };

  const onSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.error('Имя не может быть пустым');
      return;
    }
    if (trimmed === participant.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await meetingsApi.renameParticipant(meetingId, participant.id, {
        name: trimmed,
      });
      toast.success('Имя обновлено');
      setEditing(false);
      onSaved();
    } catch (e) {
      const msg = humanizeApiError(e, 'Не удалось переименовать');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-md border border-border-subtle bg-bg-base px-3 py-2">
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void onSave();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancel();
                }
              }}
              placeholder="Введите имя участника"
              maxLength={120}
              disabled={saving}
              className="flex-1 rounded-md border border-accent-border bg-bg-overlay px-2 py-1 text-sm outline-none disabled:opacity-50"
              aria-label="Имя участника"
            />
            <Button size="sm" onClick={() => void onSave()} disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              Сохранить
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
              Отмена
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-fg-primary">{participant.name}</span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-tertiary">
              {participant.role === 'host' ? 'хост' : 'гость'}
            </span>
            {canEdit ? (
              <button
                type="button"
                onClick={onStart}
                className="ml-1 grid h-6 w-6 place-items-center rounded text-fg-tertiary hover:bg-bg-overlay hover:text-accent"
                aria-label="Переименовать гостя"
                title="Переименовать гостя"
              >
                <Pencil size={12} strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

// ─────────────── Processing banner (отчёт готовится) ───────────────

/**
 * ТЗ-2 Фаза 4 — баннер на весь экран результата, пока встреча ещё не дошла до
 * финального AI-статуса и отчёта пока нет. Заменяет бесконечный скелетон —
 * страница сама обновится поллингом, когда отчёт будет готов.
 */
function ReportProcessingBanner({ title }: { title?: string }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {title ? (
        <h1 className="mb-4 text-xl font-semibold text-fg-primary">{title}</h1>
      ) : null}
      <div className="rounded-xl border border-border-subtle bg-bg-card px-6 py-8 text-center">
        <div className="mb-2 flex items-center justify-center gap-2 text-base font-medium text-fg-primary">
          <Loader2 size={16} className="animate-spin" />
          Отчёт готовится
        </div>
        <div className="mx-auto max-w-md text-sm text-fg-secondary">
          Обычно занимает несколько минут. Страница обновится автоматически,
          когда отчёт будет готов.
        </div>
      </div>
    </div>
  );
}

// ─────────────── Skeleton ───────────────

function MeetingResultSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:px-8">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="aspect-video w-full rounded-xl" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
      <Skeleton className="h-[520px] w-full rounded-xl" />
    </div>
  );
}

// ─────────────── Primitives ───────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-card p-5">
      {children}
    </div>
  );
}

function CardHeader({
  title,
  accessory,
}: {
  title: string;
  accessory?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="m-0 text-sm font-semibold text-fg-primary">{title}</h3>
      {accessory}
    </div>
  );
}
