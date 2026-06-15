import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { DataClass, SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  LlmRouterService,
  maxDataClass,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import type { StructuralRetrievalFilters } from '../../dialog-layer/services/query-plan-extractor.service';
import {
  KnowledgeAccessResolver,
  type KnowledgeAccessContext,
} from '../../rbac/knowledge-access-resolver.service';

import {
  ChatV2RetrievalService,
  type ChatV2Scope,
  type RankedBlockId,
} from './chat-v2-retrieval.service';
import { ChatV2TableContextService } from './chat-v2-table-context.service';
import { DataClassPolicyService } from './dataclass-policy.service';
import { ReasoningChainService } from './reasoning-chain.service';

/**
 * ChatV2Service — единый AI-чат поверх IdeaBlock'ов (Фаза 6 knowledge-core).
 *
 * 5 scope: org / meeting / card / theme / entity. Retrieval делегируется
 * `ChatV2RetrievalService`, эта сервис только собирает контекст, вызывает LLM,
 * парсит цитаты и возвращает результат.
 *
 * Контракт citations совместим с legacy chat (поля meetingId / meetingTitle /
 * startMs / endMs / snippet). Дополнительное поле `usedBlockIds` — для
 * отладки и будущего UI (показать какие блоки взял).
 *
 * Не делает stream/SSE — это vNext (см. decisions-log Фаза 6).
 */
export type { ChatV2Scope } from './chat-v2-retrieval.service';

/**
 * §4 Ф1 (2026-06-11) — стадии прогресса AI-чата для SSE-стриминга. Эмитятся
 * через опциональный колбэк `onStage` по ходу `ask()`, чтобы пользователь
 * видел, что система работает («Понимаю вопрос → Ищу в памяти → Пишу ответ»).
 * Это НЕ посимвольный стрим токенов — только крупные фазы.
 */
export type ChatV2Stage = 'understanding' | 'searching' | 'writing';

export interface ChatV2Input {
  tenantId: string;
  userId: string;
  scope: ChatV2Scope;
  scopeId: string | null;
  query: string;
  /**
   * История диалога (последние 6 сообщений рекомендуется): user / assistant
   * пары. Подмешивается в systemPrompt как Q/A блок.
   */
  history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * SBA α-5 dialog-layer — Conversation.summary (сжатая старая часть).
   * Если задано — подмешивается в systemPrompt ДО списка последних сообщений.
   */
  conversationSummary?: string | null;
  /**
   * SBA α-5 dialog-layer — массив запросов для retrieval (multi-query
   * expansion). Если задан и .length > 1 — fetchCandidates вызывается для
   * каждого, blockIds объединяются (dedup + max-score).
   * Если не задан — используется query как единственный запрос.
   */
  queries?: ReadonlyArray<string>;
  /**
   * SBA α-5 dialog-layer — temporal queries. Если задан — фильтр
   * `IdeaBlock.createdAt <= validAt` (см. ChatV2RetrievalService).
   */
  validAt?: Date | null;
  /**
   * Query Understanding Волна 1 — резолвнутые структурные recall-safe фильтры.
   * Ф2 только переносит до RetrievalInput; SQL-фильтрацию делает Ф3.
   */
  structuralFilters?: StructuralRetrievalFilters | null;
  /**
   * ЧАСТЬ B (ТЗ 2026-06-15 §7) — обогащённое понимание для ПАРАЛЛЕЛЬНОЙ ветки
   * поиска в умных таблицах. Все поля опциональны: если их нет (старый
   * chat-модуль / dialog-layer выключен) — табличная ветка НЕ запускается
   * (tableRows=[], граф отвечает как раньше).
   *  - `tableEntityHints` — имена-подсказки (клиенты/проекты/темы) для выбора таблицы;
   *  - `tableEntityIds` — резолвнутые сущности графа (entity-bridge по TableRow.entityId);
   *  - `tableAggregation` — счётный/агрегирующий вопрос («сколько…») → больше строк.
   */
  tableEntityHints?: ReadonlyArray<string>;
  tableEntityIds?: ReadonlyArray<string>;
  tableAggregation?: boolean;
  /**
   * SBA α-5 dialog-layer — заранее посчитанные blockIds (RetrievalCache hit).
   * Если задан — retrieval НЕ запускается, сразу loadContextBlocks.
   */
  precomputedBlockIds?: ReadonlyArray<string>;
  /**
   * SBA α-5 dialog-layer — intent для metrics и (опц.) для будущего
   * tuning'а retrieval-параметров (например, topK по intent).
   */
  intent?: 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay';
  /**
   * Override системного промпта. ТЗ 2026-06-15 — режимы factual/synthetic/
   * clone_style как «текст промпта» удалены: графовый ответ идёт на единый
   * BASE_SYSTEM_PROMPT. Override теперь подаётся только для brand-voice
   * («голос компании», clone_style+scope=org) из SynthesisService. Если не
   * задан — BASE_SYSTEM_PROMPT (единый промпт-ответчик; он же обслуживает
   * старый `chat`-модуль).
   */
  systemPromptOverride?: string | null;
  /**
   * §4 Ф1 (2026-06-11) — опциональный колбэк прогресса для SSE-стриминга.
   * Дефолт undefined = текущее поведение (никаких эмиссий). Вызывается
   * 'searching' ПЕРЕД retrieval+loadContextBlocks и 'writing' ПЕРЕД синтез-
   * вызовом LLM. Стадия 'understanding' эмитится раньше — в оркестраторе.
   * Колбэк должен быть НЕблокирующим и не бросать (caller оборачивает в try).
   */
  onStage?: (stage: ChatV2Stage) => void;
}

export interface ChatV2Citation {
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  snippet: string;
  /**
   * ТЗ-4 Ф11 — провенанс документа. Если цитируемый блок происходит из
   * загруженного документа (его evidence-RawEvent имеет
   * `sourceExternalId='doc:<id>'`), citation несёт ссылку на документ.
   * Фронт строит ссылку `/documents/<documentId>`. Для citation из встречи
   * оба поля undefined (meeting-поля как раньше). Citation может быть либо
   * встречным, либо документным.
   */
  documentId?: string;
  documentName?: string;
}

export interface ChatV2Output {
  message: string;
  citations: ChatV2Citation[];
  modelUsed: string;
  usedBlockIds: string[];
  inputTokens: number;
  outputTokens: number;
  /**
   * M-1 (2026-06-12) — derived класс данных ответа: effectiveDataClass из
   * retrieval pool (maxDataClass legacy / DataClassPolicy на enforce — тот
   * же, что уходит в llm.call). Каналы-мосты используют его, чтобы НЕ лить
   * sensitive/private текст во внешний канал (Telegram/MAX), а слать
   * указатель «откройте в кабинете». Для пустого контекста — 'internal'
   * (ответ-заглушка без данных).
   */
  dataClass: DataClass;
}

/**
 * Внутренняя структура: одна полная запись блока с evidence (для prompt-сборки
 * и парсинга citations).
 */
interface ContextBlock {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  dataClass: DataClass;
  /**
   * Первая evidence блока, привязанная к встрече (если есть). Ровно она и
   * становится citation в ответе AI.
   */
  primaryMeetingEvidence: {
    meetingId: string;
    meetingTitle: string;
    startMs: number;
    endMs: number;
    snippet: string;
  } | null;
  /**
   * ТЗ-4 Ф11 — первая evidence блока, привязанная к загруженному документу
   * (RawEvent.sourceExternalId='doc:<id>'), если у блока НЕТ meeting-evidence.
   * Используется как fallback-источник citation: блок, обоснованный
   * регламентом/политикой, цитирует документ, а не встречу.
   */
  primaryDocumentSource: {
    documentId: string;
    documentName: string;
    snippet: string;
  } | null;
}

/**
 * Query Understanding Ф4 (R10) — карта signalType → человекочитаемый русский
 * термин для честного ответа «в памяти нет по этим условиям». Несколько
 * исходных типов могут схлопываться в один термин (например, любые задачи).
 */
const SIGNAL_TYPE_RU: Record<string, string> = {
  decision: 'решения',
  task_created: 'задачи/дела',
  task_completed: 'задачи/дела',
  commitment: 'задачи/дела',
  plan_item: 'задачи/дела',
  done_item: 'задачи/дела',
  risk: 'риски',
  churn_risk: 'риски',
  blocker: 'блокеры',
  idea: 'идеи',
  client_request: 'запросы клиента',
};

/**
 * Chat-v2 единый промпт (ТЗ 2026-06-15 §6) — ПОЛНАЯ карта `SignalType` →
 * человекочитаемый русский ярлык ДЛЯ КОНТЕКСТА синтезатора. В отличие от
 * схлопывающего `SIGNAL_TYPE_RU` (он для фильтр-сообщения «по этим условиям
 * не нашёл») здесь точные ярлыки на КАЖДЫЙ тип — рамка смысла для модели
 * («это решение» vs «это жалоба клиента»).
 *
 * Тип строго `Record<SignalType, string>` — это compile-guard: новый тип в
 * enum без русского ярлыка ⇒ сборка падает (чиним весь КЛАСС утечки, не один
 * случай). НЕ заменяет `SIGNAL_TYPE_RU` (тот остаётся для describeStructuralFilters).
 */
const SIGNAL_TYPE_CONTEXT_RU: Record<SignalType, string> = {
  fact: 'факт',
  pain: 'боль (проблема)',
  feature_request: 'пожелание (запрос доработки)',
  objection: 'возражение',
  churn_risk: 'риск оттока',
  idea: 'идея',
  risk: 'риск',
  commitment: 'обязательство',
  decision: 'решение',
  mood: 'настроение',
  drift: 'отклонение',
  competitor_move: 'действие конкурента',
  metric_change: 'изменение метрики',
  knowledge_gap: 'пробел в знаниях',
  reasoning: 'рассуждение',
  rationale: 'обоснование',
  decision_basis: 'основание решения',
  regulation: 'регламент',
  process_step: 'шаг процесса',
  expertise: 'экспертиза',
  experience: 'опыт',
  competence: 'компетенция',
  methodology_step: 'шаг методологии',
  hypothesis: 'гипотеза',
  result: 'результат',
  lesson: 'извлечённый урок',
  brand_principle: 'принцип бренда',
  content_artifact: 'материал',
  commitment_status: 'статус обязательства',
  plan_item: 'пункт плана',
  done_item: 'сделанное',
  blocker: 'блокер',
  team_friction: 'трение в команде',
  process_friction: 'трение в процессе',
  resource_gap: 'нехватка ресурса',
  suggestion: 'предложение',
  client_request: 'запрос клиента',
  question: 'вопрос',
  task_created: 'задача',
  task_status_changed: 'изменение статуса задачи',
  task_blocked: 'задача заблокирована',
  task_completed: 'выполненная задача',
  task_overdue: 'просроченная задача',
  task_reassigned: 'переназначенная задача',
  task_comment: 'комментарий к задаче',
  task_mention: 'упоминание в задаче',
  help_provided: 'оказана помощь',
  proactive_hint: 'проактивная подсказка',
  mentoring: 'наставничество',
  emotional_support: 'эмоциональная поддержка',
  constructive_feedback: 'конструктивная обратная связь',
  question_unanswered: 'вопрос без ответа',
  question_acknowledged_no_action: 'вопрос принят без действий',
  helped_by: 'получил помощь',
  helped_to: 'помог коллеге',
  thanks_explicit: 'благодарность',
};

/**
 * Возвращает русский ярлык типа блока для контекста синтезатора. Через словарь
 * `SIGNAL_TYPE_CONTEXT_RU`; для неизвестного (не из enum, напр. legacy-строка) —
 * сам код как мягкий fallback.
 */
function signalTypeContextRu(signalType: string): string {
  return (
    SIGNAL_TYPE_CONTEXT_RU[signalType as SignalType] ?? signalType
  );
}

/**
 * Chat-v2 единый промпт (ТЗ 2026-06-15 §6.1) — ИМЕНОВАННЫЕ КОНСТАНТЫ русских
 * тегов контекста. Единый источник для билдера (buildUserMessage) и чистилки
 * (stripBlockMarkers): и текст, что видит модель, и regex для вырезания
 * ссылаются на одни и те же строки. Английские теги остаются в strip для
 * обратной совместимости со старыми ответами.
 */
export const REASONING_CHAIN_TAG_PREFIX = '[ЦЕПОЧКА РАССУЖДЕНИЯ К ФАКТУ';
export const CONTRADICTING_FACT_TAG = '[ПРОТИВОРЕЧАЩИЙ ФАКТ]';
export const CONTRADICTIONS_HEADER = 'Противоречащие факты:';
/** Префикс блока «Данные из таблиц» (наполняет ЧАСТЬ B; константа и strip — здесь). */
export const TABLE_TAG_PREFIX = '[ТАБЛИЦА:';

/**
 * Query Understanding Ф4 (R10) — карта ветки темы → человекочитаемый русский
 * термин.
 */
const THEME_BRANCH_RU: Record<string, string> = {
  marketing: 'маркетинг',
  sales: 'продажи',
  product: 'продукт',
  finance: 'финансы',
  team: 'команда',
  operations: 'операции',
  strategy: 'стратегия',
  clients: 'клиенты',
  technology: 'технологии',
  production: 'производство',
  partnerships: 'партнёрства',
  legal: 'юридическое',
};

/** Человекочитаемое описание применённых структурных условий (для честного
 *  ответа «в памяти нет по этим условиям»). Возвращает '' если описывать нечего. */
export function describeStructuralFilters(
  f: {
    dateFrom: Date | null;
    dateTo: Date | null;
    signalTypes: string[];
    entityIds: string[];
    themeBranches: string[];
    bitemporalActiveOnly: boolean;
  },
): string {
  const parts: string[] = [];

  if (f.dateFrom || f.dateTo) {
    parts.push('период');
  }

  if (f.signalTypes.length) {
    const terms = dedupe(f.signalTypes.map((t) => SIGNAL_TYPE_RU[t] ?? t));
    parts.push(`тип: ${terms.join('/')}`);
  }

  if (f.themeBranches.length) {
    const terms = dedupe(f.themeBranches.map((t) => THEME_BRANCH_RU[t] ?? t));
    parts.push(`тема: ${terms.join('/')}`);
  }

  if (f.entityIds.length) {
    parts.push('указанные сущности');
  }

  if (f.bitemporalActiveOnly) {
    parts.push('действующие сейчас');
  }

  return parts.join(', ');
}

/** Дедупликация с сохранением порядка первого вхождения. */
function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

const BLOCK_REF_REGEX = /\[BLOCK:([a-z0-9]+)\]/gi;

/**
 * §1 Ф5 (2026-06-11) — вырезает технические маркеры цитат из текста ответа
 * AI-чата (chat-v2), чтобы они не утекали в UI. Цитаты сохраняются отдельно
 * (массив `citations`), поэтому из видимого текста маркеры можно удалить.
 *
 * Режем только маркеры в квадратных скобках строго заданных форм:
 *   - [CONTRADICTING BLOCK ...]      — counter-evidence тег (W3.3)
 *   - [REASONING CHAIN FOR BLOCK ...]— тег цепочки обоснований (W3.2)
 *   - [BLOCK:<id>]                   — ссылка на блок (id = lowercase alnum cuid)
 *   - [ПРОТИВОРЕЧАЩИЙ ФАКТ ...]       — русский тег counter-evidence (ТЗ 06-15)
 *   - [ЦЕПОЧКА РАССУЖДЕНИЯ К ФАКТУ ...]— русский тег цепочки обоснований
 *   - [ТАБЛИЦА: ...]                  — русский тег строк умных таблиц (ЧАСТЬ B)
 * Обычный markdown ответа (списки, **жирный**, ссылки `[текст](url)`) не трогаем.
 * Английские теги (CONTRADICTING/REASONING) оставлены для обратной совместимости
 * со старыми сохранёнными ответами.
 *
 * ВАЖНО: чистая функция без сайд-эффектов (свежие regex-литералы, без общего
 * lastIndex) — применять ТОЛЬКО к возвращаемому `message`, после того как
 * citations/usedBlockIds уже распарсены из СЫРОГО текста.
 */
export function stripBlockMarkers(text: string): string {
  return text
    .replace(/\[CONTRADICTING BLOCK[^\]]*\]/gi, '')
    .replace(/\[REASONING CHAIN FOR BLOCK[^\]]*\]/gi, '')
    // Русские теги контекста (ТЗ 2026-06-15) — единый источник имён в константах
    // REASONING_CHAIN_TAG_PREFIX / CONTRADICTING_FACT_TAG / TABLE_TAG_PREFIX.
    .replace(/\[ПРОТИВОРЕЧАЩИЙ ФАКТ[^\]]*\]/g, '')
    .replace(/\[ЦЕПОЧКА РАССУЖДЕНИЯ К ФАКТУ[^\]]*\]/g, '')
    .replace(/\[ТАБЛИЦА:[^\]]*\]/g, '')
    .replace(/\[BLOCK:[a-z0-9]+\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ') // схлопнуть двойные пробелы от вырезанных маркеров
    .replace(/ +([.,;:!?])/g, '$1') // убрать пробел перед пунктуацией
    .replace(/[ \t]+\n/g, '\n') // убрать trailing-пробел перед переводом строки
    .replace(/\n{3,}/g, '\n\n') // не плодить пустые строки
    .trim();
}

/**
 * KC-Temporal W3.2 (2026-05-25) — бюджет символов на ВСЕ reasoning chain'ы
 * вместе (3 чейна по 3 узла depth=2). При превышении — fallback на depth=1.
 * 4000 символов ≈ 1000 токенов — допустимо при общем prompt-бюджете 8-16K.
 */
const CHAIN_CHARS_BUDGET = 4000;

/**
 * KC-Temporal W3.2 — отрендеренный reasoning chain (готов к подмешиванию в
 * user message).
 */
interface RenderedReasoningChain {
  seedBlockId: string;
  depth: 1 | 2;
  nodes: ReadonlyArray<{
    id: string;
    name: string;
    signalType: string;
    criticalQuestion: string;
    trustedAnswer: string;
    depth: number;
  }>;
}

/**
 * KC-Temporal W3.3 — отрендеренный counter-evidence блок.
 */
interface RenderedContradictingBlock {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  /** id того seed-блока, которому этот блок противоречит. */
  contradictsBlockId: string;
}

/**
 * Chat-v2 единый промпт-ответчик (ТЗ 2026-06-15, Приложение A, SYSTEM часть 1).
 *
 * Один промпт на ВСЕ ответы из графа — режимов «факт/синтез/в стиле сотрудника»
 * больше нет (их тексты удалены). Стабильная часть (кэшируется для всех
 * компаний): роль, границы, правила, few-shot, self-check, запреты + правила
 * чтения особых пометок контекста (цепочка рассуждения / противоречащий факт /
 * данные из таблиц). Хвост «## О компании» подмешивается отдельно per-tenant
 * (buildSystemPrompt companyAbout), сюда НЕ входит. Также обслуживает старый
 * `chat`-модуль (buildSystemPrompt fallback) — имя экспорта сохранено.
 */
export const BASE_SYSTEM_PROMPT = `## Роль
Ты — Кора, ИИ-помощник по памяти компании. Отвечаешь сотрудникам компании
на их вопросы, опираясь ТОЛЬКО на то, что компания уже зафиксировала: встречи,
переписки, решения, документы. Ты не универсальный чат-бот — ты память
и аналитик одной конкретной компании (она описана в разделе «О компании» ниже).

## Кому ты отвечаешь и что будет с ответом
- Спрашивает сотрудник компании — из кабинета или из мессенджера. Он может быть
  не из технического отдела: пиши на нормальном человеческом языке.
- Твой ответ — финальный. Его покажут человеку как есть, никто не будет его
  переписывать после тебя. Значит, он должен быть сразу понятным, аккуратным
  и честным.
- Человек спрашивает, чтобы быстро узнать, что компания уже знает или решала
  по теме, не поднимая вручную встречи и переписки. Сэкономь ему это время.

## Границы — только дела компании
Ты отвечаешь ТОЛЬКО на вопросы про эту компанию и её работу — то, что есть
или может быть в её памяти (см. «О компании» ниже).
- На посторонние темы (общие знания, новости, погода, развлечения, личные
  советы, «расскажи что-нибудь») — не отвечаешь.
- Код не пишешь и задачи, не связанные с компанией, не решаешь.
- На такую просьбу вежливо откажись: коротко скажи, что ты помощник по памяти
  компании и можешь помочь только с вопросами про неё. Не придумывай ответ
  ради «полезности».

## Как ты отвечаешь
1. Только из контекста. Опирайся строго на раздел «Контекст» в сообщении ниже.
   Не добавляй знаний «из общего опыта», которых в контексте нет.
2. Глубину выбираешь по вопросу — без жёсткого лимита. На простой фактический
   вопрос отвечай коротко и по сути. Но если какой-то момент важно пояснить,
   чтобы человек точно понял, — поясни, не обрезай себя искусственно. На вопрос
   «почему / как / в целом» — давай развёрнутый разбор. Ориентир — понятность,
   а не число предложений; и без воды.
3. Ссылайся на источник. Каждый факт подкрепляй маркером [BLOCK:<id>] прямо
   рядом с фактом — из него получится кликабельная ссылка на источник. Можно
   несколько маркеров на одно утверждение. Не придумывай номера, которых нет
   в контексте.
4. Честно про пустоту. Если ответа в контексте нет — так и скажи: «В памяти
   компании я этого не нашёл» — и не досочиняй.
5. Честно про надёжность. Где это важно, помечай словами, насколько факт
   надёжен: «по нескольким источникам» (подтверждён 2+ блоками), «однажды
   упоминалось» (единичный источник), «возможно устарело» (явно старее
   остальных или есть конфликт). Не вешай эти пометки на каждое предложение —
   только там, где это меняет доверие к факту.
6. Конфликт не заглаживай. Если факты спорят — назови оба
   ([BLOCK:<id1>] vs [BLOCK:<id2>]) и предложи человеку уточнить, какой
   актуальный. Никогда не выбирай «правильный» сам.

## Особые пометки в контексте (подсказки для тебя; в ответе их не показывай)
- «Цепочка рассуждения к факту» — разложенное «почему»: решение ← обоснование
  ← факты. Используй её для хорошего ответа на «почему», но ссылайся маркером
  только на исходный факт, а не на каждое звено.
- «Противоречащий факт» — кусок, который спорит с основным. Обязательно скажи
  про разногласие, не игнорируй; предложи уточнить, что сейчас актуально.
- «Данные из таблиц» — строки из умных таблиц компании. Используй наравне с
  фактами; при ссылке указывай таблицу «<название>» (цитата подставится сама).
  На счётный вопрос («сколько…») посчитай по строкам и дай число.

## Примеры (плохо → хорошо)
1. Два факта спорят.
   ✗ «Запуск назначен на март.»  (взял один, конфликт спрятал)
   ✓ «Данные расходятся: по одному обсуждению запуск в марте [BLOCK:11], по
     более позднему — перенесён на май [BLOCK:42]. Уточните, какая дата в силе.»
2. Ответа в памяти нет.
   ✗ «Обычно онбординг занимает пару недель.»  (досочинил из общих знаний)
   ✓ «В памяти компании я не нашёл, сколько занимает онбординг новичка —
     похоже, это нигде не зафиксировано.»
3. Технический мусор в ответе.
   ✗ «По данным CompanyProfile и блока decisions решение принято.»
   ✓ «Решение принято на встрече по партнёрству [BLOCK:7].»
4. Вопрос «почему».
   ✗ перечисляет каждое звено цепочки как отдельный факт с кучей маркеров.
   ✓ «Скидку убрали: она съедала маржу и не давала роста повторных
     продаж [BLOCK:5].»

## Самопроверка перед ответом
- Вопрос вообще про дела компании? Если нет — вежливый отказ, без выдумок.
- Каждый факт подкреплён [BLOCK:<id>] из контекста? Нет выдуманных номеров?
- Если данных не было — сказал честно, не досочинил?
- Конфликт назван, а не заглажен?
- В тексте нет ни одного английского/служебного слова, кроме маркеров
  [BLOCK:<id>]?
Если что-то не так — перепиши, и только потом отвечай.

## Запреты
- Никаких английских слов, кодов, технических названий в тексте ответа
  (кроме маркеров [BLOCK:<id>], которые станут ссылками). Даже если они есть
  во входе — переводи на человеческий русский.
- Не выдумывай факты, даты, имена, решения, которых нет в контексте.
- Не выбирай «победителя» при споре двух фактов.`;

@Injectable()
export class ChatV2Service {
  private readonly logger = new Logger(ChatV2Service.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ChatV2RetrievalService)
    private readonly retrieval: ChatV2RetrievalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    // Ф4 (knowledge-access) — резолвер групп доступа для гейта chat-v2.
    // RbacModule @Global, поэтому импорт не нужен.
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
    // W4.1 — DataClassPolicyService для shadow-compare (см. ТЗ §W4.1).
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
    // KC-Temporal W3.2 (2026-05-25) — reasoning chain hook. @Optional —
    // старые тесты, которые мокают только обязательные deps, продолжают
    // работать (без service hook просто не подмешиваем chain).
    @Optional()
    @Inject(ReasoningChainService)
    private readonly reasoningChain?: ReasoningChainService,
    // ЧАСТЬ B (ТЗ 2026-06-15 §7) — таблицы как параллельный источник. @Optional —
    // старые тесты без этого DI и worker-процесс продолжают работать (ветка
    // таблиц просто не запускается, tableRows=[]).
    @Optional()
    @Inject(ChatV2TableContextService)
    private readonly tableContext?: ChatV2TableContextService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   * Defensive try/catch — в старых unit-тестах cfg может быть mock без
   * `aiFeatures`. Default — true (как в env.schema).
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  /**
   * Главный метод. Делает retrieval, готовит prompt, вызывает LLM, парсит
   * цитаты и возвращает результат. Запись в `MeetingChatMessage` происходит
   * на уровне chat.service.ts (через ChatRepository) — этот сервис чистый,
   * без побочных эффектов на историю.
   */
  async ask(input: ChatV2Input): Promise<ChatV2Output> {
    const { tenantId, scope, scopeId, query } = input;
    const topK = this.cfg.knowledgeCore.chatV2TopBlocks;
    const graphHops = this.cfg.knowledgeCore.chatV2GraphHops;

    // Ф4 knowledge-access — режим гейта. off → ctx=null (поведение неизменно).
    const kaEnforcement = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      kaEnforcement !== 'off'
        ? await this.accessResolver.resolveAccessibleGroups({ tenantId, userId: input.userId })
        : null;
    const accessWhere =
      kaEnforcement === 'enforce' && accessCtx
        ? (this.accessResolver.buildAccessWhere(accessCtx) as Record<string, unknown>)
        : undefined;

    // Query Understanding Волна 1 — применён ли структурный recall-safe фильтр.
    this.metrics.incQueryPlanRetrievalFiltered({
      filtered: input.structuralFilters ? 'yes' : 'no',
    });

    // §4 Ф1 (2026-06-11) — стадия «Ищу в памяти»: эмитим ПЕРЕД retrieval +
    // loadContextBlocks. Колбэк опционален и не должен бросать — оборачиваем.
    try {
      input.onStage?.('searching');
    } catch {
      /* колбэк прогресса не критичен — не ломаем синтез */
    }

    // 1) Retrieval blockId'ов под scope — ПАРАЛЛЕЛЬНО с веткой умных таблиц.
    //
    // SBA α-5 dialog-layer:
    //  - precomputedBlockIds (RetrievalCache HIT) → пропускаем fetchCandidates.
    //  - queries[] (multi-query expansion) → fetchCandidates по каждой,
    //    blockIds объединяются с приоритетом первого запроса.
    //  - validAt → temporal-фильтр на pool + graph (см. ChatV2RetrievalService).
    //
    // ЧАСТЬ B (ТЗ 2026-06-15 §7) — табличная ветка (fetchTableContext) идёт
    // ОДНОВРЕМЕННО с графовым retrieval через Promise.allSettled: по времени
    // почти не дороже. Падение ветки таблиц НЕ валит ответ (граф отвечает).
    const [retrievalSettled, tableSettled] = await Promise.allSettled([
      this.runRetrieval(input, {
        tenantId,
        scope,
        scopeId: scopeId ?? null,
        query,
        topK,
        graphHops,
        accessWhere,
      }),
      this.runTableBranch(input, tenantId),
    ]);

    const rankedBlockIds: string[] =
      retrievalSettled.status === 'fulfilled' ? retrievalSettled.value : [];
    if (retrievalSettled.status === 'rejected') {
      // Графовый retrieval упал — это критично для chat-v2, но не роняем процесс:
      // дальше contextBlocks будет пустым → честный «недостаточно данных».
      this.logger.warn(
        {
          err:
            retrievalSettled.reason instanceof Error
              ? retrievalSettled.reason.message
              : String(retrievalSettled.reason),
        },
        'chat-v2 ask: графовый retrieval упал',
      );
    }
    // tableRows — fail-safe: ветка таблиц никогда не должна валить ответ.
    const tableRows: Array<{ tableName: string; cells: string }> =
      tableSettled.status === 'fulfilled' ? tableSettled.value : [];

    // 2) Выгружаем сами блоки + первую evidence из встреч + meeting title.
    //    Ф4 — главный выходной шлюз доступа (см. loadContextBlocks).
    const contextBlocks = await this.loadContextBlocks(
      tenantId,
      rankedBlockIds,
      accessCtx,
      kaEnforcement,
      'chat',
    );

    // 3) Если контекст пуст — отвечаем без LLM.
    //    Ф4 (R10): если применялся структурный фильтр — отвечаем честно,
    //    называя условия, а не общим «Недостаточно данных».
    //    ЧАСТЬ B (ТЗ 2026-06-15 §7): но если граф пуст, А ТАБЛИЦЫ дали строки
    //    (например «сколько клиентов из Москвы») — НЕ возвращаем заглушку, а идём
    //    в синтез с одними табличными данными (счётный вопрос считается по строкам).
    if (contextBlocks.length === 0 && tableRows.length === 0) {
      const desc = input.structuralFilters
        ? describeStructuralFilters(input.structuralFilters)
        : '';
      const message = input.structuralFilters
        ? desc
          ? `По заданным условиям (${desc}) в памяти ничего не нашлось.`
          : 'По заданным условиям в памяти ничего не нашлось.'
        : 'Недостаточно данных: я не нашёл подходящих блоков знаний по этому запросу.';
      // Query Understanding Волна 1 — применённый структурный фильтр дал пустой
      // пул (misroute-proxy): честный ответ «в памяти нет».
      if (input.structuralFilters) {
        this.metrics.incQueryPlanEmptyPool({ result: 'empty' });
      }
      return {
        message,
        citations: [],
        modelUsed: 'none',
        usedBlockIds: [],
        inputTokens: 0,
        outputTokens: 0,
        // M-1 — пустой контекст: ответ-заглушка без данных.
        dataClass: 'internal',
      };
    }

    // KC-Temporal W3.2 (2026-05-25) — reasoning chain hook.
    // Для top-3 source-блоков строим BFS depth=2 по reasoning-link'ам.
    // Если общий бюджет токенов цепочки превышает порог (см. константу
    // CHAIN_CHARS_BUDGET) — пересобираем depth=1 (fallback). Метрика
    // `chat_v2_reasoning_chains_attached_total{depth}` инкрементируется
    // по факту прикрепления.
    const reasoningChains = await this.buildReasoningChains(
      contextBlocks,
      accessWhere,
    );

    // KC-Temporal W3.3 (2026-05-25) — counter-evidence.
    // Для каждого блока ищем ребра `contradicts` (active) и подгружаем
    // другой конец (max 3 на блок). Метрика
    // `chat_v2_contradicting_blocks_in_context` фиксирует общее число.
    const contradictingBlocks = await this.loadContradictingBlocks(
      tenantId,
      contextBlocks,
      accessCtx,
      kaEnforcement,
    );

    // 4) Готовим prompt.
    // ТЗ 2026-06-15 §2.5 — «О компании»: стабильный per-tenant хвост SYSTEM
    // (префикс-кэш в рамках тенанта цел). Пустой профиль → секция опускается.
    const companyAbout = await this.buildCompanyAbout(tenantId);
    const scopeAddon = await this.buildScopeAddon(scope, scopeId, tenantId);
    const systemPrompt = this.buildSystemPrompt(
      scopeAddon,
      input.systemPromptOverride ?? null,
      companyAbout,
    );
    // ТЗ 2026-06-15 §6 — summary/history переехали из SYSTEM в конец USER
    // (cache-friendly: всё переменное — в USER).
    const userMessage = this.buildUserMessage(
      query,
      contextBlocks,
      reasoningChains,
      contradictingBlocks,
      {
        conversationSummary: input.conversationSummary ?? null,
        history: input.history,
        // ЧАСТЬ B — строки умных таблиц (параллельная ветка). Пусто → секция
        // «Данные из таблиц» не выводится.
        tableRows,
      },
    );

    this.logger.debug(
      {
        scope,
        scopeId,
        rankedCount: rankedBlockIds.length,
        contextCount: contextBlocks.length,
        graphHops,
        validAt: input.validAt ?? null,
        intent: input.intent ?? null,
        multiQueryCount: input.queries?.length ?? 0,
      },
      'chat-v2 ask: starting llm call',
    );

    // 5) LLM call.
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть пользовательский вопрос (query) +
    // блоки контекста + Память диалога в маркеры данных (всё переменное — в
    // USER, ТЗ 2026-06-15). Системный prompt получает INJECTION_GUARD_NOTE.
    // Память диалога теперь часть userMessage (buildUserMessage), её защищает
    // wrapUserData вместе с остальным контекстом.
    //
    // Источник = 'chat': основной user-вход — это `query`.
    const guardOn = this.isPromptInjectionGuardEnabled();
    if (guardOn) {
      const sanitized = sanitizeCustomPrompt(query);
      for (const pattern of sanitized.reasons) {
        this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
      }
    }
    const finalSystem = guardOn ? withInjectionGuard(systemPrompt) : systemPrompt;
    const finalUser = guardOn ? wrapUserData(userMessage) : userMessage;
    // W4.1/W4.2 — derive DataClass для chat_context.
    // legacy = maxDataClass(retrieval pool). proposed — derive с
    // kind='chat_context'. На enforce — передаём derive().dataClass в
    // llm.call (правильнее с точки зрения compliance: floor + private
    // aggregation учитываются). На shadow/off — legacy.
    const legacyDataClass = maxDataClass(contextBlocks.map((b) => b.dataClass));
    const enforcementChat = this.cfg?.dataClassPolicy.enforcement ?? 'off';
    const derivedChat = this.dataClassPolicy?.derive({
      sources: contextBlocks.map((b) => ({
        dataClass: b.dataClass,
        sourceId: b.id,
        sourceKind: 'idea_block' as const,
      })),
      context: { kind: 'chat_context' },
    });
    if (this.dataClassPolicy && derivedChat) {
      this.dataClassPolicy.compareWithLegacy({
        legacyResult: legacyDataClass,
        proposedResult: derivedChat.dataClass,
        kind: 'chat_context',
        sourceIds: contextBlocks.map((b) => b.id),
      });
    }
    const effectiveDataClass =
      enforcementChat === 'enforce' && derivedChat
        ? derivedChat.dataClass
        : legacyDataClass;
    // §4 Ф1 (2026-06-11) — стадия «Пишу ответ»: эмитим ПЕРЕД синтез-вызовом
    // LLM. Колбэк опционален и не должен бросать — оборачиваем.
    try {
      input.onStage?.('writing');
    } catch {
      /* колбэк прогресса не критичен — не ломаем синтез */
    }
    const result = await this.llm.call({
      taskType: 'chat-v2',
      systemPrompt: finalSystem,
      userMessage: finalUser,
      tenantId,
      userId: input.userId,
      sourceRef: { type: scope, id: scopeId ?? tenantId },
      // Фаза 11/W4.2: max dataClass по retrieval pool (с учётом floor'а).
      dataClass: effectiveDataClass,
      // §4 Ф3 (2026-06-11): свой hard-timeout синтеза chat-v2, независимый от
      // глобального LLM_ROUTER_DISPATCH_TIMEOUT_MS — длинный ответ AI-чата не
      // должен обрываться. Admin-editable (knowledge.chatV2SynthesisTimeoutMs).
      timeoutMs: this.cfg.knowledgeCore.chatV2SynthesisTimeoutMs,
    });

    // 6) Парсим citations: [BLOCK:<id>] → primaryMeetingEvidence блока.
    const citations = this.parseCitationsFromAnswer(
      result.text,
      contextBlocks,
    );
    const usedBlockIds = this.parseUsedBlockIds(result.text, contextBlocks);

    return {
      // §1 Ф5 — strip технических маркеров из видимого текста; парс цитат выше
      // уже сделан на СЫРОМ result.text (с маркерами), поэтому citations целы.
      message: stripBlockMarkers(result.text),
      citations,
      modelUsed: result.modelUsed,
      usedBlockIds,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      // M-1 — derived класс ответа (тот же, что ушёл в llm.call).
      dataClass: effectiveDataClass,
    };
  }

  // ─────────────────────────── private ───────────────────────────

  /**
   * Графовый retrieval blockId'ов под scope (вынесен из ask() для запуска
   * ПАРАЛЛЕЛЬНО с табличной веткой, ЧАСТЬ B ТЗ 2026-06-15 §7). Логика та же:
   * precomputedBlockIds → multi-query merge → topK. Возвращает ranked blockIds.
   */
  private async runRetrieval(
    input: ChatV2Input,
    ctx: {
      tenantId: string;
      scope: ChatV2Scope;
      scopeId: string | null;
      query: string;
      topK: number;
      graphHops: number;
      accessWhere: Record<string, unknown> | undefined;
    },
  ): Promise<string[]> {
    const { tenantId, scope, scopeId, query, topK, graphHops, accessWhere } = ctx;

    if (input.precomputedBlockIds && input.precomputedBlockIds.length > 0) {
      return [...input.precomputedBlockIds].slice(0, topK);
    }

    const queries: string[] =
      input.queries && input.queries.length > 0 ? [...input.queries] : [query];
    // Per-query topK поменьше для multi-query expansion'а, чтобы total после
    // merge ≈ topK * 1.5 (не раздувать LLM-контекст).
    const perQueryLimit =
      queries.length > 1
        ? Math.max(4, Math.ceil(topK / queries.length) + 2)
        : topK;
    const merged = new Map<string, number>();
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i] ?? '';
      if (!q || q.length === 0) continue;
      const ranked: RankedBlockId[] = await this.retrieval.fetchCandidates({
        tenantId,
        scope,
        scopeId: scopeId ?? null,
        query: q,
        limit: perQueryLimit,
        graphHops,
        validAt: input.validAt ?? null,
        accessWhere,
        // Query Understanding Волна 1 (Ф3 consume) — структурные фильтры.
        dateFrom: input.structuralFilters?.dateFrom ?? null,
        dateTo: input.structuralFilters?.dateTo ?? null,
        signalTypes: input.structuralFilters?.signalTypes,
        entityIds: input.structuralFilters?.entityIds,
        themeBranches: input.structuralFilters?.themeBranches,
        bitemporalActiveOnly:
          input.structuralFilters?.bitemporalActiveOnly ?? false,
      });
      // Приоритет первой query (originalOrStandalone): её score boost'ится.
      const boost = i === 0 ? 0.05 : 0;
      for (const r of ranked) {
        const prev = merged.get(r.blockId) ?? -Infinity;
        const adj = r.score + boost;
        if (adj > prev) merged.set(r.blockId, adj);
      }
    }
    return [...merged.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id]) => id);
  }

  /**
   * ЧАСТЬ B (ТЗ 2026-06-15 §7) — табличная ветка: ищет строки умных таблиц на
   * обогащённом понимании запроса (delegated to ChatV2TableContextService).
   * Запускается ПАРАЛЛЕЛЬНО с графовым retrieval (allSettled в ask()).
   *
   * Не запускаем (→ []), если:
   *  - сервис недоступен (@Optional → undefined; worker / частичная сборка), ИЛИ
   *  - нет обогащённого понимания (нет ни entityIds, ни entityHints, ни queries) —
   *    значит вызов идёт из старого chat-модуля без dialog-layer'а.
   * Никогда не бросает — fail-safe внутри сервиса; здесь дополнительный try.
   */
  private async runTableBranch(
    input: ChatV2Input,
    tenantId: string,
  ): Promise<Array<{ tableName: string; cells: string }>> {
    if (!this.tableContext) return [];
    const entityIds = input.tableEntityIds ?? [];
    const entityHints = input.tableEntityHints ?? [];
    const queries = input.queries && input.queries.length > 0 ? input.queries : [];
    // Нет обогащённого понимания — ветку не запускаем (см. ТЗ §7).
    if (entityIds.length === 0 && entityHints.length === 0 && queries.length === 0) {
      return [];
    }
    try {
      return await this.tableContext.fetchTableContext({
        tenantId,
        queries: [...queries],
        entityIds: [...entityIds],
        entityHints: [...entityHints],
        aggregation: input.tableAggregation ?? false,
      });
    } catch (err) {
      this.logger.warn(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'chat-v2 runTableBranch: сбой — возвращаем [] (граф отвечает)',
      );
      return [];
    }
  }

  /**
   * Выгружает блоки + первую evidence (привязанную к meeting RawEvent).
   * Сохраняет порядок blockIds (он отражает релевантность).
   */
  private async loadContextBlocks(
    tenantId: string,
    blockIds: string[],
    accessCtx: KnowledgeAccessContext | null,
    enforcement: 'off' | 'shadow' | 'enforce',
    surface: string,
  ): Promise<ContextBlock[]> {
    if (blockIds.length === 0) return [];

    // Ф4 knowledge-access — выходной шлюз. off (accessCtx=null) или bypass →
    // НИ одного нового запроса, effectiveIds = blockIds (байт-в-байт). При
    // shadow считаем denied (метрика), выдачу НЕ меняем. При enforce —
    // отбрасываем недоступные блоки.
    let effectiveIds = blockIds;
    if (accessCtx && !accessCtx.isBypass) {
      const { accessible, denied } = await this.accessResolver.partitionBlockIdsByAccess(
        accessCtx,
        blockIds,
      );
      if (enforcement === 'enforce') {
        effectiveIds = accessible;
        this.metrics.incAccessDenied({ surface }, denied);
      } else {
        // shadow — выдачу НЕ меняем, только метрика расхождения.
        this.metrics.incAccessShadowDiff({ surface }, denied);
      }
    }

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: effectiveIds },
        tenantId,
        status: 'canonical',
      },
      select: {
        id: true,
        name: true,
        signalType: true,
        trustedAnswer: true,
        dataClass: true,
      },
    });
    if (blocks.length === 0) return [];

    // Все evidence для этих блоков, привязанные к meeting RawEvent.
    const evidenceRows = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        blockId: { in: blocks.map((b) => b.id) },
        sourceType: 'meeting',
      },
      select: {
        blockId: true,
        rawEventId: true,
        startMs: true,
        endMs: true,
        quote: true,
      },
      orderBy: [{ startMs: 'asc' }, { createdAt: 'asc' }],
    });

    // Берём первую evidence на каждый блок.
    const firstByBlock = new Map<string, (typeof evidenceRows)[number]>();
    for (const ev of evidenceRows) {
      if (!firstByBlock.has(ev.blockId)) firstByBlock.set(ev.blockId, ev);
    }

    // Через RawEvent → meetingId, через Meeting → title.
    const rawEventIds = [...new Set(evidenceRows.map((e) => e.rawEventId))];
    const rawEvents = await this.prisma.rawEvent.findMany({
      where: { id: { in: rawEventIds } },
      select: { id: true, sourceExternalId: true },
    });
    const rawIdToMeetingId = new Map<string, string>();
    for (const r of rawEvents) {
      if (r.sourceExternalId) rawIdToMeetingId.set(r.id, r.sourceExternalId);
    }

    const meetingIds = [...new Set([...rawIdToMeetingId.values()])];
    const meetings = await this.prisma.meeting.findMany({
      where: { id: { in: meetingIds } },
      select: { id: true, title: true },
    });
    const meetingIdToTitle = new Map<string, string>();
    for (const m of meetings) meetingIdToTitle.set(m.id, m.title);

    // ТЗ-4 Ф11 — провенанс документа. Для блоков БЕЗ meeting-evidence ищем
    // первую evidence, привязанную к загруженному документу
    // (RawEvent.sourceExternalId='doc:<id>'). Так блок, обоснованный
    // регламентом/политикой, цитирует документ, а не встречу.
    const blocksWithoutMeeting = blocks
      .map((b) => b.id)
      .filter((id) => !firstByBlock.has(id));
    const docSourceByBlock = await this.loadDocumentSources(
      tenantId,
      blocksWithoutMeeting,
    );

    // Сохраняем порядок blockIds.
    const byId = new Map(blocks.map((b) => [b.id, b] as const));
    const out: ContextBlock[] = [];
    for (const id of blockIds) {
      const b = byId.get(id);
      if (!b) continue;
      const ev = firstByBlock.get(id);
      let primary: ContextBlock['primaryMeetingEvidence'] = null;
      if (ev) {
        const meetingId = rawIdToMeetingId.get(ev.rawEventId);
        const meetingTitle = meetingId
          ? meetingIdToTitle.get(meetingId) ?? '—'
          : null;
        if (meetingId && meetingTitle) {
          primary = {
            meetingId,
            meetingTitle,
            startMs: ev.startMs ?? 0,
            endMs: ev.endMs ?? 0,
            snippet: ev.quote.slice(0, 240),
          };
        }
      }
      // ТЗ-4 Ф11 — document fallback (только если нет meeting-evidence).
      const docSource = primary ? null : docSourceByBlock.get(id) ?? null;
      out.push({
        id: b.id,
        name: b.name,
        signalType: b.signalType,
        trustedAnswer: b.trustedAnswer,
        dataClass: b.dataClass,
        primaryMeetingEvidence: primary,
        primaryDocumentSource: docSource,
      });
    }
    return out;
  }

  /**
   * ТЗ-4 Ф11 — батч-резолв документного провенанса для блоков, у которых нет
   * meeting-evidence. Переиспользует тот же путь, что и
   * `DocumentsService.getDetail`: IdeaBlockEvidence → RawEvent с
   * `sourceExternalId='doc:<id>'`. Возвращает Map blockId → {documentId,
   * documentName, snippet}. Один findMany по evidence + один по document —
   * без N+1. tenantId-scope сохранён (block + rawEvent + document по tenantId).
   */
  private async loadDocumentSources(
    tenantId: string,
    blockIds: string[],
  ): Promise<
    Map<string, { documentId: string; documentName: string; snippet: string }>
  > {
    const result = new Map<
      string,
      { documentId: string; documentName: string; snippet: string }
    >();
    if (blockIds.length === 0) return result;

    // Evidence этих блоков, чей RawEvent — документ (sourceExternalId 'doc:').
    const evidenceRows = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        blockId: { in: blockIds },
        rawEvent: {
          tenantId,
          sourceExternalId: { startsWith: 'doc:' },
        },
      },
      select: {
        blockId: true,
        quote: true,
        rawEvent: { select: { sourceExternalId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (evidenceRows.length === 0) return result;

    // Первая doc-evidence на блок + сбор documentId'ов (для одного findMany).
    type DocEvidence = { documentId: string; snippet: string };
    const firstDocByBlock = new Map<string, DocEvidence>();
    const documentIds = new Set<string>();
    for (const ev of evidenceRows) {
      if (firstDocByBlock.has(ev.blockId)) continue;
      const ext = ev.rawEvent?.sourceExternalId;
      if (!ext || !ext.startsWith('doc:')) continue;
      const documentId = ext.slice('doc:'.length);
      if (!documentId) continue;
      firstDocByBlock.set(ev.blockId, {
        documentId,
        snippet: ev.quote.slice(0, 240),
      });
      documentIds.add(documentId);
    }
    if (documentIds.size === 0) return result;

    // Батч-резолв имён документов (tenantId-scope, не удалённые).
    const documents = await this.prisma.document.findMany({
      where: {
        id: { in: [...documentIds] },
        tenantId,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });
    const docNameById = new Map<string, string>();
    for (const d of documents) docNameById.set(d.id, d.name);

    for (const [blockId, ev] of firstDocByBlock) {
      const documentName = docNameById.get(ev.documentId);
      // Документ удалён / другой tenant — пропускаем (нет валидной ссылки).
      if (!documentName) continue;
      result.set(blockId, {
        documentId: ev.documentId,
        documentName,
        snippet: ev.snippet,
      });
    }
    return result;
  }

  /**
   * Scope-зависимая добавка к system prompt.
   */
  private async buildScopeAddon(
    scope: ChatV2Scope,
    scopeId: string | null,
    tenantId: string,
  ): Promise<string> {
    if (scope === 'org' || !scopeId) {
      return 'Контекст вопроса: вся база знаний организации.';
    }
    if (scope === 'meeting') {
      const m = await this.prisma.meeting.findUnique({
        where: { id: scopeId },
        select: { title: true, type: true, tenantId: true },
      });
      if (m && m.tenantId === tenantId) {
        return `Контекст вопроса: одна встреча "${m.title}" (тип: ${m.type}). Отвечай только на основе её блоков.`;
      }
      return 'Контекст вопроса: одна встреча.';
    }
    if (scope === 'card') {
      const c = await this.prisma.card.findUnique({
        where: { id: scopeId },
        select: { name: true, kind: true, tenantId: true },
      });
      if (c && c.tenantId === tenantId) {
        return `Контекст вопроса: карточка "${c.name}" (тип: ${c.kind}). Отвечай только на основе её блоков и встреч.`;
      }
      return 'Контекст вопроса: одна карточка.';
    }
    if (scope === 'theme') {
      const t = await this.prisma.theme.findUnique({
        where: { id: scopeId },
        select: { name: true, branch: true, tenantId: true },
      });
      if (t && t.tenantId === tenantId) {
        return `Контекст вопроса: AI-тема "${t.name}"${t.branch ? ` (ветка: ${t.branch})` : ''}.`;
      }
      return 'Контекст вопроса: одна AI-тема.';
    }
    if (scope === 'entity') {
      const e = await this.prisma.entity.findUnique({
        where: { id: scopeId },
        select: { canonicalName: true, type: true, tenantId: true },
      });
      if (e && e.tenantId === tenantId) {
        return `Контекст вопроса: сущность "${e.canonicalName}" (${e.type}).`;
      }
      return 'Контекст вопроса: одна сущность.';
    }
    return '';
  }

  /**
   * ТЗ 2026-06-15 §2.5 — собирает стабильный per-tenant хвост «## О компании»
   * для SYSTEM. Минимально и безопасно: краткое имя (displayName) + стадия +
   * первый абзац миссии (contentMd) — простые текстовые поля, без разбора
   * сложных JSON-деревьев. Если профиля/полей нет — возвращает '' (секция
   * опускается, мягкая деградация). Стабилен от запроса к запросу → префикс-
   * кэш в рамках тенанта цел.
   */
  private async buildCompanyAbout(tenantId: string): Promise<string> {
    try {
      const profile = await this.prisma.companyProfile.findUnique({
        where: { tenantId },
        select: { displayName: true, stage: true, missionJson: true },
      });
      if (!profile) return '';
      const lines: string[] = [];
      const name = profile.displayName?.trim();
      if (name) lines.push(`Название: ${name}`);
      const stage = profile.stage?.trim();
      if (stage) lines.push(`Стадия: ${stage}`);
      const mission = extractContentMdSafe(profile.missionJson);
      if (mission) lines.push(`Миссия: ${mission}`);
      if (lines.length === 0) return '';
      return ['## О компании', ...lines].join('\n');
    } catch (err) {
      // «О компании» — мягкая секция: любая ошибка чтения профиля не должна
      // ронять ответ. Просто опускаем секцию.
      this.logger.warn(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'chat-v2 buildCompanyAbout: чтение CompanyProfile упало — секция опущена',
      );
      return '';
    }
  }

  /**
   * Собирает system prompt: единый промпт (или override для старого chat-
   * модуля) + scope-addon + «О компании» (стабильный per-tenant хвост).
   *
   * ТЗ 2026-06-15 §6 — summary/history БОЛЬШЕ НЕ в SYSTEM (переехали в конец
   * USER, buildUserMessage): SYSTEM целиком стабилен (cache-friendly).
   *  - `systemPromptOverride` — обслуживает старый `chat`-модуль; null →
   *    BASE_SYSTEM_PROMPT (единый промпт-ответчик).
   *  - `companyAbout` — стабильное описание компании; '' → секция опускается.
   */
  private buildSystemPrompt(
    scopeAddon: string,
    systemPromptOverride?: string | null,
    companyAbout?: string,
  ): string {
    const base =
      systemPromptOverride && systemPromptOverride.length > 0
        ? systemPromptOverride
        : BASE_SYSTEM_PROMPT;
    const parts: string[] = [base, '', scopeAddon];
    if (companyAbout && companyAbout.length > 0) {
      parts.push('', companyAbout);
    }
    return parts.join('\n');
  }

  /**
   * Собирает user message (всё переменное — здесь, в конце; кэш не ломается):
   * Память диалога (summary+history) → «Контекст:» с блоками → (если есть)
   * цепочки рассуждения → (если есть) противоречащие факты → (если есть)
   * данные из таблиц → «Вопрос:».
   *
   * ТЗ 2026-06-15 §6 — человеческий русский контекст: тип блока — русским
   * ярлыком (SIGNAL_TYPE_CONTEXT_RU), теги — русскими константами
   * (REASONING_CHAIN_TAG_PREFIX / CONTRADICTING_FACT_TAG / TABLE_TAG_PREFIX).
   */
  private buildUserMessage(
    query: string,
    blocks: ReadonlyArray<ContextBlock>,
    reasoningChains: ReadonlyArray<RenderedReasoningChain>,
    contradictingBlocks: ReadonlyArray<RenderedContradictingBlock>,
    extra?: {
      conversationSummary?: string | null;
      history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
      /**
       * ЧАСТЬ B (таблицы как источник) — строки умных таблиц. Сейчас опц./
       * пусто: ветку retrieval таблиц наполняет другой кодер; здесь готов
       * рендер блока «Данные из таблиц» через TABLE_TAG_PREFIX. Пусто →
       * секция не выводится.
       */
      tableRows?: ReadonlyArray<{ tableName: string; cells: string }>;
    },
  ): string {
    const parts: string[] = [];

    // ТЗ 2026-06-15 §6 — Память диалога в НАЧАЛЕ USER (переехала из SYSTEM).
    const summary = extra?.conversationSummary;
    if (summary && summary.length > 0) {
      parts.push('Краткое содержание диалога:', summary, '');
    }
    const history = extra?.history;
    if (history && history.length > 0) {
      const last = history.slice(-6);
      parts.push('Последние сообщения диалога:');
      for (const m of last) {
        const role = m.role === 'user' ? 'Пользователь' : 'Ассистент';
        // Обрезаем длинные сообщения, чтобы prompt не разрастался (600 симв.).
        const trimmed =
          m.content.length > 600 ? `${m.content.slice(0, 600)}…` : m.content;
        parts.push(`- ${role}: ${trimmed}`);
      }
      parts.push('');
    }

    parts.push('Контекст:');
    for (const b of blocks) {
      const head = `[BLOCK:${b.id}] ${b.name} (${signalTypeContextRu(b.signalType)}): ${b.trustedAnswer}`;
      parts.push(head);
      const ev = b.primaryMeetingEvidence;
      if (ev) {
        parts.push(
          `  Из встречи "${ev.meetingTitle}" [${formatMmSs(ev.startMs)}]: "${ev.snippet}"`,
        );
      }
    }

    // Цепочки рассуждения (русский тег; служебные depth/nodes убраны).
    for (const chain of reasoningChains) {
      parts.push('');
      parts.push(`${REASONING_CHAIN_TAG_PREFIX} ${chain.seedBlockId}]`);
      for (const n of chain.nodes) {
        // Пропускаем сам seed (он уже в основном контексте).
        if (n.id === chain.seedBlockId) continue;
        const indent = '  '.repeat(Math.max(1, n.depth));
        parts.push(
          `${indent}- (${signalTypeContextRu(n.signalType)}) ${n.name}: ${n.trustedAnswer}`,
        );
      }
    }

    // Противоречащие факты (русский тег + русский заголовок).
    if (contradictingBlocks.length > 0) {
      parts.push('');
      parts.push(CONTRADICTIONS_HEADER);
      for (const c of contradictingBlocks) {
        parts.push(
          `${CONTRADICTING_FACT_TAG} (противоречит [BLOCK:${c.contradictsBlockId}]) [BLOCK:${c.id}] ${c.name} (${signalTypeContextRu(c.signalType)}): ${c.trustedAnswer}`,
        );
      }
    }

    // ЧАСТЬ B — данные из таблиц (рендер готов; наполнение — отдельным кодером).
    const tableRows = extra?.tableRows;
    if (tableRows && tableRows.length > 0) {
      parts.push('');
      parts.push('Данные из таблиц:');
      for (const r of tableRows) {
        parts.push(`${TABLE_TAG_PREFIX} ${r.tableName}] ${r.cells}`);
      }
    }

    parts.push('', 'Вопрос:', query);
    return parts.join('\n');
  }

  /**
   * KC-Temporal W3.2 (2026-05-25) — для top-3 source-блоков строит reasoning
   * chain. При превышении CHAR-бюджета (защита от token-overflow) делает
   * fallback на depth=1.
   */
  private async buildReasoningChains(
    blocks: ReadonlyArray<ContextBlock>,
    accessWhere?: Record<string, unknown>,
  ): Promise<RenderedReasoningChain[]> {
    if (!this.reasoningChain) return [];
    if (blocks.length === 0) return [];
    const topBlocks = blocks.slice(0, 3);

    // Шаг 1: пробуем depth=2 для каждого top-блока.
    // Ф4 — при enforce передаём accessWhere в buildChain: BFS не подгружает
    // недоступные соседние блоки (R11 — граф reasoning не протаскивает закрытого).
    // off/shadow → accessWhere undefined → поведение байт-в-байт.
    const depth2Chains: RenderedReasoningChain[] = [];
    let totalChars = 0;
    for (const b of topBlocks) {
      try {
        const chain = await this.reasoningChain.buildChain(b.id, 2, accessWhere);
        if (chain.nodes.length <= 1) continue; // только seed — не интересно.
        const rendered = {
          seedBlockId: b.id,
          depth: 2 as const,
          nodes: chain.nodes,
        };
        depth2Chains.push(rendered);
        totalChars += this.estimateChainChars(rendered);
      } catch (err) {
        this.logger.warn(
          { blockId: b.id, err: err instanceof Error ? err.message : String(err) },
          'chat-v2 reasoning-chain: buildChain depth=2 упал, пропускаем',
        );
      }
    }
    // Если все depth=2 цепочки помещаются — отдаём их.
    if (totalChars <= CHAIN_CHARS_BUDGET) {
      for (const _c of depth2Chains) {
        this.metrics.incChatV2ReasoningChainsAttached({ depth: 2 });
      }
      return depth2Chains;
    }

    // Шаг 2 (fallback): depth=1.
    const depth1Chains: RenderedReasoningChain[] = [];
    for (const b of topBlocks) {
      try {
        const chain = await this.reasoningChain.buildChain(b.id, 1, accessWhere);
        if (chain.nodes.length <= 1) continue;
        depth1Chains.push({
          seedBlockId: b.id,
          depth: 1 as const,
          nodes: chain.nodes,
        });
      } catch {
        // best-effort, уже залогировано выше при depth=2.
      }
    }
    for (const _c of depth1Chains) {
      this.metrics.incChatV2ReasoningChainsAttached({ depth: 1 });
    }
    return depth1Chains;
  }

  /**
   * Грубая оценка размера chain'а в символах — без token-counter'а.
   * 1 узел ≈ name + trustedAnswer + indent + signalType ≈ ~200 символов.
   */
  private estimateChainChars(chain: RenderedReasoningChain): number {
    let total = 0;
    for (const n of chain.nodes) {
      total += n.name.length + n.trustedAnswer.length + n.signalType.length + 20;
    }
    return total;
  }

  /**
   * KC-Temporal W3.3 (2026-05-25) — counter-evidence. Для каждого блока
   * ищет `IdeaBlockLink.relationType='contradicts'` (active), подгружает
   * другой конец (canonical, того же tenant'а). Max 3 contradicting на блок.
   * Дедуп по `contradicting block id` — один блок не показывается дважды
   * (даже если противоречит сразу нескольким основным).
   *
   * Метрика `chat_v2_contradicting_blocks_in_context` (histogram) — общее
   * число (после дедупа) на один ответ.
   */
  private async loadContradictingBlocks(
    tenantId: string,
    blocks: ReadonlyArray<ContextBlock>,
    accessCtx: KnowledgeAccessContext | null,
    enforcement: 'off' | 'shadow' | 'enforce',
  ): Promise<RenderedContradictingBlock[]> {
    if (blocks.length === 0) {
      this.metrics.observeChatV2ContradictingBlocksInContext(0);
      return [];
    }
    const blockIds = blocks.map((b) => b.id);
    // Все contradicts-связи, где один из концов — наш блок.
    const links = await this.prisma.ideaBlockLink.findMany({
      where: {
        tenantId,
        status: 'active',
        relationType: 'contradicts',
        OR: [
          { fromBlockId: { in: blockIds } },
          { toBlockId: { in: blockIds } },
        ],
      },
      select: {
        fromBlockId: true,
        toBlockId: true,
        confidence: true,
      },
      // Сортировка по confidence — берём более «уверенные» противоречия.
      orderBy: { confidence: 'desc' },
      // 3 contradicting на блок × max blocks ~ 16 — лимит на пул 48.
      take: 64,
    });

    // Считаем «другой конец» для каждой связи + лимитируем по 3 на блок.
    const seenContradicting = new Set<string>();
    const perSeedCount = new Map<string, number>();
    type ContradictingPair = { seedId: string; otherId: string };
    const pairs: ContradictingPair[] = [];
    const seenSeeds = new Set(blockIds);
    for (const l of links) {
      const seedIsFrom = seenSeeds.has(l.fromBlockId);
      const seedId = seedIsFrom ? l.fromBlockId : l.toBlockId;
      const otherId = seedIsFrom ? l.toBlockId : l.fromBlockId;
      // Самопротиворечие (fromBlockId=toBlockId) — пропускаем.
      if (seedId === otherId) continue;
      // Если other тоже из набора blocks — это «внутренний» конфликт, не
      // counter-evidence. UI Chat-v2 уже обращает на это внимание через
      // BASE_SYSTEM_PROMPT. Пропускаем.
      if (seenSeeds.has(otherId)) continue;
      const count = perSeedCount.get(seedId) ?? 0;
      if (count >= 3) continue;
      if (seenContradicting.has(otherId)) continue;
      seenContradicting.add(otherId);
      perSeedCount.set(seedId, count + 1);
      pairs.push({ seedId, otherId });
    }
    if (pairs.length === 0) {
      this.metrics.observeChatV2ContradictingBlocksInContext(0);
      return [];
    }

    // Ф4 knowledge-access — counter-evidence блоки приходят через граф
    // (contradicts-рёбра) → R11: граф НЕ протаскивает недоступного. Гейтим
    // otherId до выборки. off (accessCtx=null) / bypass → effectivePairs=pairs
    // (байт-в-байт). enforce — отбрасываем недоступные; shadow — метрика.
    let effectivePairs = pairs;
    if (accessCtx && !accessCtx.isBypass) {
      const otherIds = [...new Set(pairs.map((p) => p.otherId))];
      const { accessible, denied } = await this.accessResolver.partitionBlockIdsByAccess(
        accessCtx,
        otherIds,
      );
      if (enforcement === 'enforce') {
        const allowed = new Set(accessible);
        effectivePairs = pairs.filter((p) => allowed.has(p.otherId));
        this.metrics.incAccessDenied({ surface: 'chat' }, denied);
      } else {
        // shadow — выдачу НЕ меняем, только метрика расхождения.
        this.metrics.incAccessShadowDiff({ surface: 'chat' }, denied);
      }
    }
    if (effectivePairs.length === 0) {
      this.metrics.observeChatV2ContradictingBlocksInContext(0);
      return [];
    }

    // Подгружаем сами contradicting blocks (canonical, того же tenant'а).
    const fetched = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: effectivePairs.map((p) => p.otherId) },
        tenantId,
        status: 'canonical',
      },
      select: {
        id: true,
        name: true,
        signalType: true,
        trustedAnswer: true,
      },
    });
    const byId = new Map(fetched.map((b) => [b.id, b]));

    const out: RenderedContradictingBlock[] = [];
    for (const p of effectivePairs) {
      const b = byId.get(p.otherId);
      if (!b) continue;
      out.push({
        id: b.id,
        name: b.name,
        signalType: b.signalType,
        trustedAnswer: b.trustedAnswer,
        contradictsBlockId: p.seedId,
      });
    }
    this.metrics.observeChatV2ContradictingBlocksInContext(out.length);
    return out;
  }

  /**
   * Парсит [BLOCK:<id>] из ответа AI. Для каждого валидного blockId — берём
   * primaryMeetingEvidence и формируем citation. Дедуп по meetingId+startMs.
   */
  private parseCitationsFromAnswer(
    answer: string,
    blocks: ReadonlyArray<ContextBlock>,
  ): ChatV2Citation[] {
    const byId = new Map(blocks.map((b) => [b.id, b] as const));
    const out: ChatV2Citation[] = [];
    const seen = new Set<string>();
    for (const m of answer.matchAll(BLOCK_REF_REGEX)) {
      const id = m[1];
      if (!id) continue;
      const block = byId.get(id);
      if (!block) continue;
      if (block.primaryMeetingEvidence) {
        const ev = block.primaryMeetingEvidence;
        const key = `meeting:${ev.meetingId}:${ev.startMs}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          meetingId: ev.meetingId,
          meetingTitle: ev.meetingTitle,
          startMs: ev.startMs,
          endMs: ev.endMs,
          snippet: ev.snippet,
        });
      } else if (block.primaryDocumentSource) {
        // ТЗ-4 Ф11 — citation на загруженный документ (ответ обоснован
        // регламентом/политикой). meeting-поля пустые, фронт строит ссылку
        // `/documents/<documentId>`. Дедуп по documentId.
        const doc = block.primaryDocumentSource;
        const key = `doc:${doc.documentId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          meetingId: '',
          meetingTitle: '',
          startMs: 0,
          endMs: 0,
          snippet: doc.snippet,
          documentId: doc.documentId,
          documentName: doc.documentName,
        });
      }
    }
    return out;
  }

  /**
   * Уникальные blockId, на которые сослался AI (валидные — из контекста).
   */
  private parseUsedBlockIds(
    answer: string,
    blocks: ReadonlyArray<ContextBlock>,
  ): string[] {
    const valid = new Set(blocks.map((b) => b.id));
    const out = new Set<string>();
    for (const m of answer.matchAll(BLOCK_REF_REGEX)) {
      const id = m[1];
      if (id && valid.has(id)) out.add(id);
    }
    return [...out];
  }
}

function formatMmSs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * ТЗ 2026-06-15 §2.5 — безопасно достаёт `contentMd` (миссия) из JSON-поля
 * CompanyProfile. Тот же контракт, что в company-profile.service.ts
 * (`{ contentMd, ... }`), но локально и без зависимости от Prisma-типов: на
 * вход `unknown`, на выход обрезанная строка либо null. Обрезаем до 600
 * символов — «О компании» должна оставаться компактным стабильным хвостом.
 */
function extractContentMdSafe(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>).contentMd;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
}
