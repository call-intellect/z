'use client';

/**
 * `/integrations/import-tracker` — миграционный wizard
 * (Wave 3 / Tracker Phase 5 part 1).
 *
 * Точка входа: выбор источника (Trello / Битрикс24 / Я.Трекер).
 * Trello — live wizard на 4 шага (Подключение → Доски → Маппинг → Preview).
 * Битрикс24 и Я.Трекер — placeholder «Скоро» (backend-заглушки уже есть, но
 * worker сразу падает — UI не пускаем).
 *
 * RBAC: только owner / admin Org (бэкенд проверяет `import_tracker:write`).
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileJson,
  Hourglass,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { importsApi, type UserMappings } from '@/api/tracker/imports.api';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

// ─── Сырая структура Trello JSON-export (минимум полей, нужный wizard'у) ────

interface TrelloMemberRaw {
  id?: string;
  email?: string | null;
  fullName?: string;
  username?: string;
}

interface TrelloListRaw {
  id?: string;
  idBoard?: string;
  closed?: boolean;
}

interface TrelloCardRaw {
  id?: string;
  idBoard?: string;
  closed?: boolean;
  attachments?: Array<{ id?: string; url?: string }>;
}

interface TrelloActionRaw {
  type?: string;
  data?: { card?: { id?: string; idBoard?: string } };
}

interface TrelloBoardRaw {
  id?: string;
  name?: string;
  closed?: boolean;
}

interface TrelloExportRaw {
  boards?: TrelloBoardRaw[];
  // Однодосочный экспорт — поля плоско в корне (один board).
  id?: string;
  name?: string;
  lists?: TrelloListRaw[];
  cards?: TrelloCardRaw[];
  members?: TrelloMemberRaw[];
  actions?: TrelloActionRaw[];
}

// ─── Распарсенная сводка для wizard'а ───────────────────────────────────────

interface ParsedBoard {
  id: string;
  name: string;
  cardsCount: number;
  attachmentsCount: number;
  commentsCount: number;
}

interface ParsedTrelloExport {
  /** Исходный объект — отправим как jsonContent на бэкенд. */
  raw: Record<string, unknown>;
  boards: ParsedBoard[];
  /** Email'ы members'ов из выбранных досок. */
  memberEmails: string[];
}

type WizardStep = 'upload' | 'boards' | 'mapping' | 'preview';

interface SourceCard {
  id: 'trello' | 'bitrix24' | 'yandex_tracker';
  label: string;
  emoji: string;
  description: string;
  available: boolean;
}

const SOURCES: SourceCard[] = [
  {
    id: 'bitrix24',
    label: 'Битрикс24',
    emoji: '🟦',
    description:
      'REST API через входящий webhook URL. Полная поддержка задач, групп, комментариев.',
    available: false,
  },
  {
    id: 'trello',
    label: 'Trello',
    emoji: '🟩',
    description:
      'Импорт из JSON-export файла (Настройки доски → Печать и экспорт).',
    available: true,
  },
  {
    id: 'yandex_tracker',
    label: 'Яндекс Трекер',
    emoji: '🟧',
    description:
      'OAuth-токен Яндекс ID. Перенос очередей, задач, комментариев, связей.',
    available: false,
  },
];

// ─── Парсинг Trello JSON ────────────────────────────────────────────────────

function parseTrelloExport(raw: unknown): ParsedTrelloExport | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as TrelloExportRaw;

  // Trello отдаёт два формата: одиночная доска (поля плоско) или мульти-board.
  const boardsArr: TrelloBoardRaw[] = Array.isArray(obj.boards)
    ? obj.boards
    : obj.id && obj.name
      ? [{ id: obj.id, name: obj.name, closed: false }]
      : [];
  if (boardsArr.length === 0) return null;

  const cards = Array.isArray(obj.cards) ? obj.cards : [];
  const actions = Array.isArray(obj.actions) ? obj.actions : [];
  const members = Array.isArray(obj.members) ? obj.members : [];

  // Если одиночный board — у cards могут не быть idBoard. Заполним эвристикой.
  const inferredBoardId =
    boardsArr.length === 1 && boardsArr[0] ? boardsArr[0].id : null;

  const cardsByBoard = new Map<string, TrelloCardRaw[]>();
  for (const c of cards) {
    if (c.closed) continue;
    const bid = c.idBoard ?? inferredBoardId ?? '';
    if (!bid) continue;
    const list = cardsByBoard.get(bid);
    if (list) list.push(c);
    else cardsByBoard.set(bid, [c]);
  }

  const commentsByBoard = new Map<string, number>();
  for (const a of actions) {
    if (a.type !== 'commentCard') continue;
    const bid = a.data?.card?.idBoard ?? inferredBoardId ?? '';
    if (!bid) continue;
    commentsByBoard.set(bid, (commentsByBoard.get(bid) ?? 0) + 1);
  }

  const boards: ParsedBoard[] = boardsArr
    .filter((b): b is TrelloBoardRaw & { id: string; name: string } =>
      Boolean(b.id && b.name && !b.closed),
    )
    .map((b) => {
      const cs = cardsByBoard.get(b.id) ?? [];
      const attachmentsCount = cs.reduce(
        (sum, c) => sum + (Array.isArray(c.attachments) ? c.attachments.length : 0),
        0,
      );
      return {
        id: b.id,
        name: b.name,
        cardsCount: cs.length,
        attachmentsCount,
        commentsCount: commentsByBoard.get(b.id) ?? 0,
      };
    });

  const memberEmails = Array.from(
    new Set(
      members
        .map((m) => (m.email ?? '').trim().toLowerCase())
        .filter((e): e is string => e.length > 0),
    ),
  );

  return {
    raw: raw as Record<string, unknown>,
    boards,
    memberEmails,
  };
}

// ─── UserMapping decision per email ─────────────────────────────────────────

type MappingDecision = 'unmatched' | 'invite' | 'skip';

// ─── Главный клиент ─────────────────────────────────────────────────────────

export function ImportTrackerClient() {
  const { currentOrgId, currentOrgRole } = useAuth();
  const isPrivileged =
    currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const [activeSource, setActiveSource] = useState<SourceCard['id'] | null>(
    null,
  );

  if (!currentOrgId) {
    return (
      <Shell>
        <div className="rounded-md border border-border-subtle bg-bg-card p-6 text-sm text-fg-secondary">
          Нужно войти в организацию, чтобы запустить импорт.
        </div>
      </Shell>
    );
  }

  if (!isPrivileged) {
    return (
      <Shell>
        <div className="flex items-start gap-3 rounded-md border border-warn/30 bg-warn/10 p-4 text-sm text-warn">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            Импорт могут запускать только владелец или администратор
            организации. Попроси своего админа подключить трекер за вас.
          </div>
        </div>
      </Shell>
    );
  }

  if (activeSource === 'trello') {
    return (
      <Shell>
        <TrelloWizard
          orgId={currentOrgId}
          onCancel={() => setActiveSource(null)}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <SourcePicker
        onPick={(src) => {
          if (src.available) {
            setActiveSource(src.id);
          }
        }}
      />
    </Shell>
  );
}

// ─── Shell (общий обёрточный layout) ────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Импорт задач из других трекеров
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Перенесите проекты, задачи, комментарии и вложения из Trello,
          Битрикс24 или Яндекс Трекера в Кору.
        </p>
      </header>
      {children}
    </div>
  );
}

// ─── Шаг 0: выбор источника ─────────────────────────────────────────────────

function SourcePicker({ onPick }: { onPick: (src: SourceCard) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {SOURCES.map((src) => (
        <Card
          key={src.id}
          className="flex flex-col p-5 transition-shadow hover:shadow-md"
        >
          <div className="text-3xl">{src.emoji}</div>
          <div className="mt-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-fg-primary">
              {src.label}
            </h2>
            {!src.available && (
              <span className="rounded-full bg-bg-overlay px-2 py-0.5 text-[11px] font-medium text-fg-tertiary">
                Скоро
              </span>
            )}
          </div>
          <p className="mt-2 grow text-sm text-fg-secondary">
            {src.description}
          </p>
          <div className="mt-4">
            <Button
              size="sm"
              variant={src.available ? 'default' : 'outline'}
              disabled={!src.available}
              onClick={() => onPick(src)}
              className="w-full"
            >
              {src.available ? (
                <>
                  Подключить <ArrowRight size={14} />
                </>
              ) : (
                'Скоро'
              )}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Trello wizard (4 шага) ─────────────────────────────────────────────────

function TrelloWizard({
  orgId,
  onCancel,
}: {
  orgId: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { addToast } = useToast();

  const [step, setStep] = useState<WizardStep>('upload');
  const [parsed, setParsed] = useState<ParsedTrelloExport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selectedBoardIds, setSelectedBoardIds] = useState<Set<string>>(
    new Set(),
  );
  const [decisions, setDecisions] = useState<Record<string, MappingDecision>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);

  // Сводка по выбранным board'ам.
  const summary = useMemo(() => {
    if (!parsed) return { boards: 0, cards: 0, attachments: 0, comments: 0 };
    const sel = parsed.boards.filter((b) => selectedBoardIds.has(b.id));
    return {
      boards: sel.length,
      cards: sel.reduce((s, b) => s + b.cardsCount, 0),
      attachments: sel.reduce((s, b) => s + b.attachmentsCount, 0),
      comments: sel.reduce((s, b) => s + b.commentsCount, 0),
    };
  }, [parsed, selectedBoardIds]);

  // ── Шаг 1: загрузка файла ─────────────────────────────────────────
  const handleFile = async (file: File) => {
    setParseError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const out = parseTrelloExport(json);
      if (!out || out.boards.length === 0) {
        setParseError(
          'Не удалось распознать JSON. Убедитесь, что это экспорт из Trello (формат «JSON»).',
        );
        return;
      }
      setParsed(out);
      // По умолчанию выбираем все board'ы.
      setSelectedBoardIds(new Set(out.boards.map((b) => b.id)));
      // По умолчанию все unmatched email'ы — игнорировать.
      const dec: Record<string, MappingDecision> = {};
      for (const email of out.memberEmails) {
        dec[email] = 'unmatched';
      }
      setDecisions(dec);
      setStep('boards');
    } catch {
      setParseError(
        'Файл не похож на валидный JSON. Попробуйте экспортировать доску заново.',
      );
    }
  };

  const goNext = () => {
    if (step === 'upload') setStep('boards');
    else if (step === 'boards') setStep('mapping');
    else if (step === 'mapping') setStep('preview');
  };
  const goBack = () => {
    if (step === 'preview') setStep('mapping');
    else if (step === 'mapping') setStep('boards');
    else if (step === 'boards') setStep('upload');
    else onCancel();
  };

  const canContinueFromBoards = selectedBoardIds.size > 0;
  const canContinueFromMapping = parsed
    ? parsed.memberEmails.every((e) => decisions[e] !== undefined)
    : false;

  // ── Шаг 4: запуск импорта ─────────────────────────────────────────
  const handleStart = async () => {
    if (!parsed) return;
    const userMappings: UserMappings = {};
    for (const [email, decision] of Object.entries(decisions)) {
      if (decision === 'invite') {
        // Backend ждёт email → ourUserId. Для invite-by-email мы не знаем
        // конечного userId сейчас; backend сам подхватит после регистрации.
        // По схеме DTO значение должно быть string (ourUserId) ИЛИ null.
        // Wave 3 part 1: invite-flow ещё не реализован — записываем null,
        // чтобы worker записал email в unmatched (для логов админа).
        userMappings[email] = null;
      } else if (decision === 'skip') {
        userMappings[email] = null;
      }
      // unmatched — пропускаем ключ, чтобы попал в ImportLog.unmatchedJson.
    }

    setSubmitting(true);
    try {
      const res = await importsApi.startTrello(orgId, {
        jsonContent: parsed.raw,
        selectedBoardIds: Array.from(selectedBoardIds),
        userMappings,
      });
      addToast({ type: 'success', message: 'Импорт запущен' });
      router.push(`/integrations/import-tracker/${res.importLogId}`);
    } catch (e) {
      addToast({
        type: 'error',
        message:
          e instanceof ApiError
            ? e.message
            : 'Не удалось запустить импорт. Попробуйте ещё раз.',
      });
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <WizardSteps current={step} />

      {step === 'upload' && (
        <UploadStep
          onFile={(f) => void handleFile(f)}
          error={parseError}
          onCancel={onCancel}
        />
      )}

      {step === 'boards' && parsed && (
        <BoardsStep
          parsed={parsed}
          selected={selectedBoardIds}
          onToggle={(id) => {
            setSelectedBoardIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          }}
          onAll={() =>
            setSelectedBoardIds(new Set(parsed.boards.map((b) => b.id)))
          }
          onNone={() => setSelectedBoardIds(new Set())}
          onBack={goBack}
          onNext={goNext}
          canNext={canContinueFromBoards}
        />
      )}

      {step === 'mapping' && parsed && (
        <MappingStep
          emails={parsed.memberEmails}
          decisions={decisions}
          setDecision={(email, d) =>
            setDecisions((prev) => ({ ...prev, [email]: d }))
          }
          onBack={goBack}
          onNext={goNext}
          canNext={canContinueFromMapping}
        />
      )}

      {step === 'preview' && parsed && (
        <PreviewStep
          summary={summary}
          decisions={decisions}
          emailsTotal={parsed.memberEmails.length}
          onBack={goBack}
          onStart={() => void handleStart()}
          submitting={submitting}
        />
      )}
    </div>
  );
}

// ─── Step indicator ─────────────────────────────────────────────────────────

function WizardSteps({ current }: { current: WizardStep }) {
  const order: WizardStep[] = ['upload', 'boards', 'mapping', 'preview'];
  const labels: Record<WizardStep, string> = {
    upload: '1. Подключение',
    boards: '2. Доски',
    mapping: '3. Маппинг',
    preview: '4. Подтверждение',
  };
  const idx = order.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs font-medium text-fg-tertiary">
      {order.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <li
            key={s}
            className={
              active
                ? 'rounded-full bg-accent/10 px-3 py-1 text-accent'
                : done
                  ? 'rounded-full bg-bg-overlay px-3 py-1 text-fg-secondary'
                  : 'rounded-full bg-bg-overlay px-3 py-1'
            }
          >
            {labels[s]}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1: Upload ─────────────────────────────────────────────────────────

function UploadStep({
  onFile,
  error,
  onCancel,
}: {
  onFile: (f: File) => void;
  error: string | null;
  onCancel: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
            <FileJson size={18} />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-fg-primary">
              Шаг 1: Загрузите JSON-export из Trello
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              В Trello откройте доску → Меню справа → «Печать и экспорт» →
              «Экспортировать как JSON». Сохраните файл и загрузите его сюда.
            </p>
          </div>
        </div>

        <label
          htmlFor="trello-file"
          className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border-subtle bg-bg-elevated px-6 py-10 text-center transition-colors hover:border-accent/50"
        >
          <Upload size={24} className="text-fg-tertiary" />
          <div className="text-sm font-medium text-fg-primary">
            Перетащите файл сюда или нажмите для выбора
          </div>
          <div className="text-xs text-fg-tertiary">
            Поддерживается .json до 50 МБ
          </div>
          <input
            id="trello-file"
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              // Сбрасываем value, чтобы повторный выбор того же файла триггерил onChange.
              e.target.value = '';
            }}
          />
        </label>

        {error && (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onCancel}>
            <ArrowLeft size={14} /> К выбору источника
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 2: Boards ─────────────────────────────────────────────────────────

function BoardsStep({
  parsed,
  selected,
  onToggle,
  onAll,
  onNone,
  onBack,
  onNext,
  canNext,
}: {
  parsed: ParsedTrelloExport;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
  onBack: () => void;
  onNext: () => void;
  canNext: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-fg-primary">
              Шаг 2: Выберите доски для импорта
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Найдено досок: {parsed.boards.length}. Каждая доска станет
              отдельным проектом в Коре.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onAll}>
              Все
            </Button>
            <Button variant="outline" size="sm" onClick={onNone}>
              Снять выбор
            </Button>
          </div>
        </div>

        <ul className="mt-4 space-y-2">
          {parsed.boards.map((b) => {
            const isSel = selected.has(b.id);
            return (
              <li key={b.id}>
                <label
                  className={
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ' +
                    (isSel
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-border-subtle bg-bg-card hover:border-accent/30')
                  }
                >
                  <Checkbox
                    checked={isSel}
                    onCheckedChange={() => onToggle(b.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg-primary">
                      {b.name}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-tertiary">
                      Карточек: {b.cardsCount} · Комментариев: {b.commentsCount} · Вложений: {b.attachmentsCount}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={14} /> Назад
          </Button>
          <Button onClick={onNext} disabled={!canNext}>
            Дальше <ArrowRight size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 3: Mapping ────────────────────────────────────────────────────────

function MappingStep({
  emails,
  decisions,
  setDecision,
  onBack,
  onNext,
  canNext,
}: {
  emails: string[];
  decisions: Record<string, MappingDecision>;
  setDecision: (email: string, d: MappingDecision) => void;
  onBack: () => void;
  onNext: () => void;
  canNext: boolean;
}) {
  if (emails.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-fg-primary">
            Шаг 3: Маппинг пользователей
          </h2>
          <p className="mt-2 text-sm text-fg-secondary">
            В выгрузке нет пользователей с email — этот шаг можно пропустить.
            Исполнители останутся пустыми (или с raw-именем в комментариях).
          </p>
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft size={14} /> Назад
            </Button>
            <Button onClick={onNext}>
              Дальше <ArrowRight size={14} />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold text-fg-primary">
          Шаг 3: Маппинг пользователей
        </h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Найдено {emails.length} email-адресов в выгрузке. Для каждого выберите,
          что делать. Если email совпадает с нашим пользователем — он
          автоматически станет исполнителем.
        </p>

        <ul className="mt-4 space-y-2">
          {emails.map((email) => (
            <li
              key={email}
              className="flex flex-col items-start gap-2 rounded-md border border-border-subtle bg-bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg-primary">
                  {email}
                </div>
                <div className="text-xs text-fg-tertiary">
                  Из выгрузки Trello
                </div>
              </div>
              <Select
                value={decisions[email] ?? 'unmatched'}
                onValueChange={(v) =>
                  setDecision(email, v as MappingDecision)
                }
              >
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unmatched">
                    Оставить в списке «не сопоставлено»
                  </SelectItem>
                  <SelectItem value="invite">
                    Пригласить по email (заглушка)
                  </SelectItem>
                  <SelectItem value="skip">
                    Игнорировать (без исполнителя)
                  </SelectItem>
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p>
            «Пригласить по email» в этом релизе сохраняет адрес в журнале
            «не сопоставлено» — отдельно вы сможете отправить приглашения из
            раздела «Команда». Исполнители будут проставлены задним числом
            после того, как пользователь зарегистрируется.
          </p>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={14} /> Назад
          </Button>
          <Button onClick={onNext} disabled={!canNext}>
            Дальше <ArrowRight size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 4: Preview ────────────────────────────────────────────────────────

function PreviewStep({
  summary,
  decisions,
  emailsTotal,
  onBack,
  onStart,
  submitting,
}: {
  summary: { boards: number; cards: number; attachments: number; comments: number };
  decisions: Record<string, MappingDecision>;
  emailsTotal: number;
  onBack: () => void;
  onStart: () => void;
  submitting: boolean;
}) {
  const invites = Object.values(decisions).filter((d) => d === 'invite').length;
  const skips = Object.values(decisions).filter((d) => d === 'skip').length;
  const unmatched = emailsTotal - invites - skips;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-muted text-accent">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-fg-primary">
              Шаг 4: Подтверждение
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Сейчас будет создано столько сущностей. После старта импорт
              нельзя поставить на паузу, но можно отменить.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryTile icon={<ClipboardList size={16} />} label="Доски → Проекты" value={summary.boards} />
          <SummaryTile label="Карточки → Задачи" value={summary.cards} />
          <SummaryTile label="Комментарии" value={summary.comments} />
          <SummaryTile label="Вложения" value={summary.attachments} />
        </dl>

        <div className="mt-5 rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm">
          <div className="mb-2 font-medium text-fg-primary">
            Пользователи из выгрузки
          </div>
          <ul className="space-y-1 text-fg-secondary">
            <li>Будет приглашено по email: <b>{invites}</b></li>
            <li>Игнорировано: <b>{skips}</b></li>
            <li>Останется в журнале «не сопоставлено»: <b>{unmatched}</b></li>
          </ul>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-fg-secondary">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent" />
          <p>
            Импорт идемпотентен: если запустить повторно тот же экспорт — мы
            не создадим дубли. Уже импортированные задачи будут пропущены.
          </p>
        </div>

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={onBack} disabled={submitting}>
            <ArrowLeft size={14} /> Назад
          </Button>
          <Button onClick={onStart} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Запускаем…
              </>
            ) : (
              <>
                <Hourglass size={14} /> Начать импорт
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-fg-tertiary">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-fg-primary">{value}</div>
    </div>
  );
}
