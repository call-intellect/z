import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { DataClass, LlmRouteTier, LlmTaskRoute } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { AiUsageLogService } from './ai-usage-log.service';
import { AnthropicService } from './anthropic.service';
import { BudgetGuardService } from './budget-guard.service';
import { DeepSeekService } from './deepseek.service';
import { GrsaiService } from './grsai.service';
import { KieService } from './kie.service';
import { LlmInvalidOutputError } from './llm.types';
import type {
  LlmCompleteInput,
  LlmCompleteOutput,
  LlmResponseFormat,
  LlmReasoningEffort,
  LlmTool,
  LlmToolCall,
} from './llm.types';
import { MinimaxService } from './minimax.service';
import { calcCostUsd, MODEL_PRICES } from './model-prices';
import { OllamaService } from './ollama.service';
import { OpenAiProxyService } from './openai-proxy.service';
import { LlmProtocolAdapterRegistry } from './protocol-adapter/llm-protocol-adapter.registry';
import { ProviderInfoResolver } from './protocol-adapter/provider-info.resolver';

/**
 * Семейство задач, для которых LlmRouter определяет провайдера.
 *
 * Legacy: summary/chapters/tasks/chat/regenerate-section/custom-prompt/
 * follow-up/clip-title/card-rollup/card-chat.
 *
 * Knowledge-core (Фаза 2+): block-ingest, block-distill, block-linker,
 * entity-resolver, entity-merge-arbiter, entity-graph-builder, theme-classify,
 * reframing, card-rollup-v2, chat-v2, goal-alignment, dashboard-summary.
 */
export type LlmTaskType =
  | 'summary'
  | 'chapters'
  | 'tasks'
  | 'chat'
  | 'regenerate-section'
  | 'custom-prompt'
  | 'follow-up'
  | 'clip-title'
  | 'card-rollup'
  | 'card-chat'
  | 'block-ingest'
  | 'chunk-context'
  | 'block-distill'
  | 'block-linker'
  | 'entity-resolver'
  | 'entity-merge-arbiter'
  | 'entity-name-resolve'
  | 'block-link-confirm'
  | 'rag-route'
  | 'rag-plan'
  | 'rag-rerank'
  | 'rag-sufficiency'
  | 'rag-groundedness'
  | 'entity-graph-builder'
  | 'theme-classify'
  // Ф8 граф-ингест (2026-06-23) — инкрементальная суть темы/кластера (map-reduce).
  | 'theme-summarize'
  | 'reframing'
  | 'card-rollup-v2'
  | 'chat-v2'
  | 'goal-alignment'
  | 'dashboard-summary'
  | 'role-profile-build'
  | 'transcript-clean-refine'
  // Фаза B — refine для метрик поведения (классификация filler/question).
  | 'behavior-refine'
  // Фаза C — AI-оценка качества встречи (sub-TZ C §5.4).
  | 'meeting-quality-score'
  // Фаза E — дополнительные («custom») AI-отчёты встречи. Один общий taskType
  // для всех шаблонов; per-template override — через UI админки моделей,
  // которая создаёт более специфичный route. См. ТЗ E §5.5.
  | 'custom-report'
  // SBA α-5 — Layer 5 Chat-v2 Omnichannel.
  // 'chat-v2-cite-select' — пост-обработка, выбор лучших цитат (опц., на α-5
  // не используется — заведён про запас).
  // 'chat-v2-conversation-title' — короткий title диалога (3-7 слов) из
  // первого user-сообщения (см. ConversationsService.generateTitle).
  | 'chat-v2-cite-select'
  | 'chat-v2-conversation-title'
  // Редизайн кабинета Ф5а (2026-06-13) — авто-название встречи.
  // 'meeting-title' — короткое название встречи (3-7 слов) из типа + первых
  // реплик транскрипта. Перезаписывает только плейсхолдер-title (см.
  // MeetingTitleService.generateMeetingTitle). Дешёвая задача — едет по
  // DEFAULT_FALLBACK_CHAIN, отдельный seed-route не требуется.
  | 'meeting-title'
  // SBA α-7 — Specialist 3.1 (Regulations / Processes / Policies).
  // 'regulation-extract' — извлечение черновика Regulation/Process/Policy из блока.
  // 'regulation-dedupe' — арбитр merge/new/extension/contradicts (KNN-кандидаты).
  | 'regulation-extract'
  | 'regulation-dedupe'
  // SBA α-7 wave 2 — Specialist 3.1 ProcessTemplate detector.
  // 'process-template-extract' — батч IdeaBlock'ов (signalType=process_step|methodology_step)
  // → массив кандидатов ProcessTemplate (name + summary + steps).
  | 'process-template-extract'
  // SBA β-2 — Specialist 3.2 (Knowledge Clone).
  // 'knowledge-clone-extract' — из набора блоков сотрудника → черновик
  //   knowledgeProfile (категории + опыт).
  // 'knowledge-clone-merge' — старый профиль + новый черновик → объединённый
  //   профиль с decay устаревших категорий.
  | 'knowledge-clone-extract'
  | 'knowledge-clone-merge'
  // SBA β-3 — Specialist 3.3 (Decisions Registry).
  // 'decision-extract' — из IdeaBlock (signalType=decision|rationale|decision_basis)
  //   → черновик Decision (statement + rationale + alternatives + hints).
  // 'decision-supersede-detect' — арбитр {new | merge | supersedes} по top-K KNN
  //   кандидатам; на supersedes — evolvingMeta для resolve.
  | 'decision-extract'
  | 'decision-supersede-detect'
  // SBA β-4 — Specialist 3.5 (Insights Radar).
  // 'insight-extract' — из IdeaBlock (signalType=pain|risk|churn_risk|objection)
  //   → черновик Insight (kind, statement, severity, affectedEntityHints, mitigationSuggestion).
  // 'insight-link-to-decisions' — для нового Insight найти Decision'ы, которые
  //   могли его спровоцировать (linked-decision arbiter).
  | 'insight-extract'
  | 'insight-link-to-decisions'
  // SBA β-5 — Specialist 3.6 (Ideas Collector) + Layer 6 (Probe-Agent).
  // 'idea-extract' — из IdeaBlock (signalType=idea|feature_request) → черновик Idea.
  // 'idea-cluster-merge' — арбитр кластеризации (new_cluster|add|standalone).
  // 'probe-formulate' — короткий точечный вопрос для Probe-Agent (2–4 inline options).
  // 'idea-status-summarize' — title+body для closing-loop нотификации
  //   supporter'ам идеи при изменении статуса.
  | 'idea-extract'
  | 'idea-cluster-merge'
  | 'probe-formulate'
  | 'idea-status-summarize'
  // Agents v2 Фаза 0.1 (2026-05-30) — Probe-Response-Classify.
  // Лёгкий классификатор свободного ответа на probe-вопрос (текст или
  // голос после ASR). Извлекает {answer, confidence, requiresFollowup}.
  // См. prompts/probe-response-classify.prompt.ts.
  | 'probe-response-classify'
  // Probe Фаза 2 (2026-06-17) — LLM-судья качества формулировки probe-вопроса.
  // После probe-formulate проверяет {ok, issues, rewrite}: не пустой/не
  // расплывчатый/без кода-латиницы/один вопрос/отвечаем человеку/≤400 симв.
  // При браке (ok=false) и валидном rewrite — один регенерат. Best-effort:
  // судья упал → шлём исходный. См. probe/prompts/probe-quality-judge.prompt.ts.
  | 'probe-quality-judge'
  | 'probe-value-gate'
  | 'probe-draft-from-memory'
  | 'subject-memory-rule-extract'
  | 'subject-memory-judge'
  | 'company-summary-compile'
  | 'task-assignee-arbiter'
  // Agents v2 Фаза A2 (2026-05-30) — Multi-Agent Debate.
  // Зонтичный taskType для debate-decision-supersede (учёт/seed/budget).
  // Реальные LLM-вызовы идут через три stance-specific taskType'а ниже,
  // каждый со своим primary провайдером (для diverse-моделей):
  //   - 'debate-decision-supersede-critic'    → deepseek-v4-pro (capable, склонен к отказу)
  //   - 'debate-decision-supersede-supporter' → openai-via-proxy:gpt-5.4 (другой провайдер для diversity)
  //   - 'debate-decision-supersede-neutral'   → deepseek-v4-flash (дешёвый арбитр)
  // См. plans/tz/2026-05-29-agents-v2-umbrella.md §A2 и
  // backend/src/modules/ai/services/multi-agent-debate.service.ts.
  | 'debate-decision-supersede'
  | 'debate-decision-supersede-critic'
  | 'debate-decision-supersede-supporter'
  | 'debate-decision-supersede-neutral'
  // Action Center A1 «лестница доверия» (2026-06-02) — Curation-Verify debate.
  // AI-судья канонизации критических карточек (regulation/process/decision)
  // Слоя 4. Зонтичный taskType + 3 stance-specific (critic/supporter/neutral),
  // семейство `curation-verify` в MultiAgentDebateService.
  //   - 'debate-curation-verify-critic'    → deepseek-v4-flash (cheap; склонна к reject)
  //   - 'debate-curation-verify-supporter' → gpt-5.4-mini (diverse провайдер)
  //   - 'debate-curation-verify-neutral'   → deepseek-v4-flash (cheap арбитр)
  | 'debate-curation-verify'
  | 'debate-curation-verify-critic'
  | 'debate-curation-verify-supporter'
  | 'debate-curation-verify-neutral'
  // Autonomy W1 (2026-06-12) — Conflict-Arbiter debate (LLM-арбитр конфликтов
  // знаний). Ночной cron авто-резолвит ConflictItem(open) при уверенном
  // консенсусе дебата (семейство `conflict-arbiter` в MultiAgentDebateService).
  // Зонтичный taskType + 3 stance-specific:
  //   - 'debate-conflict-arbiter-critic'    → deepseek-v4-flash (консервативен: сомнение → keep_old)
  //   - 'debate-conflict-arbiter-supporter' → gpt-5.4-mini (diverse провайдер; за accept_new при обоснованности)
  //   - 'debate-conflict-arbiter-neutral'   → deepseek-v4-flash (взвешенный арбитр)
  // См. backend/src/modules/curation/workers/conflict-arbiter.cron.ts.
  | 'debate-conflict-arbiter'
  | 'debate-conflict-arbiter-critic'
  | 'debate-conflict-arbiter-supporter'
  | 'debate-conflict-arbiter-neutral'
  // SBA γ-1 — Specialist 3.7 (SkillProfile) + Clone API.
  // 'skill-trait-detect' — самая ответственная задача γ-1: 5+ reasoning-цитат
  //   сотрудника → один структурированный SkillTrait (эмерджентная категория +
  //   гипотезная формулировка + confidence). Качество модели здесь определяет
  //   полезность всей γ-фазы (см. зонтичный §3.4 + sub-TZ §12).
  // 'skill-trait-merge' — арбитр merge/supersedes/new по top-K KNN-кандидатам.
  // 'executable-persona-compile' — собирает persona prompt («думай как X»)
  //   из списка активных traits.
  // 'clone-respond' — генерирует ответ в стиле сотрудника на вопрос
  //   (persona prompt + subgraph context + question → текст + citations).
  | 'skill-trait-detect'
  | 'skill-trait-merge'
  | 'skill-trait-verify' // grounding-проверка черты клона перед персоной
  | 'executable-persona-compile'
  | 'clone-respond'
  // ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — Смысловые блоки навыка.
  // 'skill-trait-concept-name' — лёгкий агент: получает N формулировок одной
  //   черты (после слияния SkillTraitConcept в cron-нормализаторе) и предлагает
  //   короткое каноническое имя (3-6 слов). Вызывается ТОЛЬКО при слиянии 2+
  //   концептов; при создании одиночной черты — берётся category как есть.
  | 'skill-trait-concept-name'
  // TZ clone-method Э1.2 (2026-06-12) — Reflection-слой принципов роли.
  // 'role-principle-synthesize' — ночной cron: из групп reasoning-цитат
  //   носителей должности извлекает обобщённые принципы ПРОЦЕССА
  //   (`RolePrinciple`, situation + statement + grounding sourceBlockIds).
  | 'role-principle-synthesize'
  // TZ clone-method Э1.3 (2026-06-12) — детектор ценностей/мотивации из
  //   trade-off («решающих моментов») в reasoning-цитатах: второй проход
  //   rebuild 3.7 пишет SkillTrait layer=value|motivation (clone-method Э1.3),
  //   дешёвый частый — flash.
  | 'value-motivation-detect'
  // TZ clone-method Э2.1 (2026-06-12) — детектор маркеров процесса:
  //   из reasoning-цитат извлекает повторяемый конструктивный ПРИЁМ
  //   проработки решений («перечисляет критерии», «перепроверяет данными»);
  //   третий проход rebuild 3.7 пишет SkillTrait layer=process_marker,
  //   дешёвый — flash.
  | 'process-marker-detect'
  // TZ clone-method Э3.1 (2026-06-12) — CDM-интервью носителя роли: по
  //   свежему реальному кейсу (reasoning-цитатам) формулирует ОДИН открытый
  //   не наводящий вопрос ретроспективного разбора (Critical Decision
  //   Method); вопрос уходит носителю через probe. Редкий — capable.
  | 'cdm-case-interview'
  // TZ clone-method ВАЛ.1 (2026-06-12) — LLM-judge поведенческой верности
  //   клона: еженедельный cron на реальных кейсах роли сравнивает ответы
  //   клона с persona v1 (baseline «только черты») vs v2 (все слои метода);
  //   оценивает ТОЛЬКО поведенческий ход. Дешёвый — flash.
  | 'persona-behavior-judge'
  // dialog-layer — препроцессор chat-v2 (Classifier / модуль понимания запроса
  // / Summarizer). ТЗ 2026-06-14 (контекстуализатор + оценщик уверенности
  // удалены — слиты в модуль понимания запроса dialog-multi-query).
  // - dialog-classify: intent ∈ {factual|exploratory|analytical|clone-roleplay}.
  // - dialog-multi-query: модуль понимания запроса — история → 3 самодостаточных вопроса.
  // - dialog-summarize: сжатие старой части диалога (>12 сообщений) в summary.
  | 'dialog-classify'
  | 'dialog-multi-query'
  | 'dialog-summarize'
  // Query Understanding Волна 1 (ТЗ 2026-06-10 Tier 0) — извлечение плана
  // запроса (период/типы сигналов/ветки тем/сущности/«я»/агрегация) для
  // recall-safe фильтрации chat-v2. Дешёвый, частый — primary flash (Р9).
  | 'dialog-extract-plan'
  // Ф4b (edinyy-pomoshnik) — слитый модуль понимания: один вызов выдаёт
  // 3 переформулировки + 8-осевой план фильтров. Дешёвый, частый.
  | 'dialog-understand'
  // Support desk Ф3 (support-desk-clone) — клон техподдержки: черновик ответа
  // из закрытого контура (capable, Б9), critic-проверка обоснованности и
  // классификация типа правки (оба дёшево, deepseek-v4-flash, Б9).
  | 'support-clone-draft'
  | 'support-answer-critic'
  | 'support-edit-classify'
  // Support desk Ф4 (support-desk-clone) — ночной куратор контура: решение
  // keep|promote|fix|merge|archive по блокам базы (capable, Б9).
  | 'support-contour-curate'
  // ТЗ 2026-05-25 §9.4.4 (clone-respond эволюция, Фаза 7) — multi-query
  // расширение для клонов: на входе вопрос к клону, на выходе 3 формулировки
  // (точная / ситуационный аналог / общий принцип) для retrieval по
  // аналогии. Отдельный route, primary — deepseek-v4-pro.
  | 'dialog-multi-query-clone'
  // SBA α-7 wave 2 — Specialist 3.1 ProcessTemplate detector.
  // 'process-template-extract' — батч IdeaBlock'ов
  //   (signalType=process_step|methodology_step) → массив кандидатов
  //   ProcessTemplate (name + summary + steps).
  | 'process-template-extract'
  // SBA α-3 wave 3 — AxisClassifierService + LLM-fallback Router.
  // 'axis-classify' — классификация IdeaBlock'а по 4 осям (who/functional/
  //   contextual/temporal). Дешёвый, частый — primary Ollama qwen3.5:9b.
  // 'router-fallback' — fallback роутер: для unmatched signalType
  //   определяем специалистов через LLM. Тот же провайдер-профиль.
  | 'axis-classify'
  | 'router-fallback'
  // SBA β-7 — Brand Voice Curator (Specialist 3.10).
  // 'brand-voice-extract' — daily-cron сборка BrandVoiceProfile из brand_corpus
  //   документов + brand_principle блоков → структурированный профиль
  //   (tone/values/taboos). Нужна высокая точность (стиль бренда — критичный
  //   контент), поэтому primary = gpt-4o.
  | 'brand-voice-extract'
  // SBA γ-3 — Cross-Functional Process + Handoff Tracker.
  // 'cross-functional-friction-summary' — короткое summary cross-functional
  //   friction-отчёта: на входе template + process_friction блоки + handoffs
  //   с slaViolations → описание (что тормозит) + recommendedAction.
  | 'cross-functional-friction-summary'
  // SBA α-8 wave 4 — Role Map builder + completeness rationale.
  // 'role-map-extract' — батч IdeaBlock'ов одной роли (signalType=expertise|
  //   competence|methodology_step|decision_basis|process_step) → массив
  //   нормализованных wave-2 элементов (responsibilities, authority, knowledge,
  //   decisions, interactions). См. plans/tz/2026-05-23-sba-alpha-8-wave4-*.md.
  // 'role-completeness-rationale' — короткое (1-3 предложения) объяснение для
  //   tooltip, почему такая completeness и что заполнить.
  | 'role-map-extract'
  | 'role-completeness-rationale'
  // SBA β-6 — Experiment Tracker (Specialist 3.9).
  // 'experiment-extract' — из IdeaBlock (signalType=hypothesis|result|lesson)
  //   → черновик Experiment (name, hypothesisText, currentResult?, lessons[],
  //   status, confidence). JSON Schema strict.
  // 'experiment-summarize-lessons' — digest-агрегатор уроков по серии
  //   завершённых экспериментов (используется в γ+ дайджестах; зарезервирован).
  | 'experiment-extract'
  | 'experiment-summarize-lessons'
  // SBA γ-2 — Concierge Agent (sквозной UX-слой через tool-use).
  // 'concierge-respond' — главный LLM-вызов: тoоl-use loop с whitelist tools.
  //   Primary = openai-via-proxy/gpt-4o (нужна качественная поддержка tool-use).
  // 'concierge-toolcall-validate' — валидация параметров tool call перед
  //   выполнением (lightweight). Primary = ollama/qwen3.5:9b.
  | 'concierge-respond'
  | 'concierge-toolcall-validate'
  // Ф6 assistant-channels (2026-06-11) — текстовое подтверждение мутаций в
  // каналах (Telegram/MAX): классификация ответа пользователя на запрос
  // подтверждения действия (confirm|reject|unclear). Дёшево и часто —
  // primary deepseek-v4-flash (см. seed-llm-task-routes-concierge.ts).
  | 'assistant-confirm-classify'
  // SBA β-8 — DailyCheckIn + OperationsDashboard.
  // 'checkin-parse' — из сырого ответа пользователя (морнинг/ивнинг) →
  //   структурированный { plans[], dones[], blockers[] } + confidence.
  //   < 0.6 → raw + curatorReview=true (см. DailyCheckInService).
  // 'operations-summary' — короткий narrative summary («пульс компании
  //   сейчас») поверх агрегата OperationsDashboardService. Используется
  //   COO dashboard'ом (на β-8 — опционально, фронт может не показывать).
  // SBA β-8.1 — добивка панели операционного директора.
  // 'checkin-sentiment' — определить настроение чек-ина (green/yellow/red)
  //   по тексту вечернего ответа. Дёшевый частый вызов; primary deepseek-chat,
  //   secondary openai gpt-4o-mini, tertiary ollama qwen3.5:9b.
  // 'operations-weekly-digest' — собрать связный текст недельной сводки
  //   (5-7 коротких разделов markdown) поверх агрегата за 7 дней. Один вызов
  //   в неделю на Org — не критично к скорости. Та же цепочка провайдеров.
  | 'checkin-parse'
  | 'operations-summary'
  | 'checkin-sentiment'
  | 'day-signal-detect'
  // ТЗ 2026-05-25 LLM-architecture §6 — batch-вариант checkin-sentiment.
  // 10 чек-инов в одном вызове через tool `submit_batch_sentiments`.
  // Эксперимент 4: точность 100% vs 96% single, в 2× дешевле, на 20% быстрее.
  // Primary `deepseek/deepseek-v4-pro` (capable + thinking). max_tokens=8000.
  | 'checkin-sentiment-batch'
  | 'operations-weekly-digest'
  // SBA β-8.3 — ежедневный отчёт COO.
  // 'operations-daily-digest' — собрать связный текст ежедневного отчёта
  //   (4-6 коротких разделов markdown + shortSummary для Telegram) поверх
  //   агрегата за вчерашние сутки. Один вызов в день на Org. Та же цепочка
  //   провайдеров, что и у operations-weekly-digest.
  | 'operations-daily-digest'
  // «Месяц компании» — свод 4 недельных дайджестов в месячный executive-брифинг.
  | 'operations-monthly-digest'
  // TZ-1 Фаза 1 (daily-value-engine) — Радар клиентов под риском.
  // 'customer-risk-digest' — ТОЛЬКО финальная человекочитаемая формулировка
  //   подсказки по клиенту под риском (агрегация — чистый SQL/TS, без LLM).
  //   Дешёвая задача → primary deepseek-v4-flash. Один вызов на клиента под
  //   риском в день. Без ₽-оценок (Р6).
  | 'customer-risk-digest'
  // TZ-1 Фаза 2 (daily-value-engine) — движок рядового «Твой день».
  // 'personal-brief-hint' — ТОЛЬКО «1 подсказка дня» в персональном брифе
  //   (сам бриф структурный SQL+шаблон; «кто знает X» — embeddings, не chat-LLM).
  //   Дешёвая задача → primary deepseek-v4-flash. Один вызов на сотрудника в
  //   день. Без выдуманных фактов/₽.
  | 'personal-brief-hint'
  // TZ-1 Фаза 3.A (daily-value-engine) — накопительный синтез блокеров.
  // 'blocker-synthesis-summary' — ТОЛЬКО финальный абзац-сводка по
  //   синтезированным блокерам Org за день (кластеризация/статусы/импакт —
  //   чистый SQL/TS + embeddings, без LLM). Дешёвая задача → primary
  //   deepseek-v4-flash. Один вызов на Org в день. Без выдуманных фактов/₽.
  | 'blocker-synthesis-summary'
  // TZ-1 Фаза 5 (daily-value-engine) — месячная витрина value-recap.
  // 'value-recap-narrative' — ТОЛЬКО человекочитаемая сводка ПОВЕРХ уже
  //   посчитанных твёрдых цифр (счётчики/дельта — чистый SQL/TS, без LLM).
  //   Дешёвая задача → primary deepseek-v4-flash. Один вызов на Org в месяц.
  //   Без выдуманных рублей; soft-цифры помечаются «оценка» (Р6).
  | 'value-recap-narrative'
  // SBA β-8.2 — Promise Keeper («Хранитель обещаний»).
  // 'commitment-extract-dates' — извлечь срок и адресата из текста обещания
  //   (вызов из block-ingest для уточнения если основной prompt не справился).
  //   Primary deepseek-chat, secondary gpt-4o-mini, tertiary ollama qwen3.5.
  // 'commitment-extract-status' — разобрать ответ сотрудника на followup
  //   ('fulfilled' | 'missed' + rationale + blockerText?). Та же цепочка.
  | 'commitment-extract-dates'
  | 'commitment-extract-status'
  // SBA δ-1 — Orchestrator (multi-agent research).
  // 'orchestrator-plan'        — план шагов: primary gpt-4o (важно качество reasoning).
  // 'orchestrator-subagent'    — универсальный subagent-call: primary deepseek (массово+дёшево).
  // 'orchestrator-synthesize'  — финальный синтез результатов: primary gpt-4o.
  // 'orchestrator-verify'      — верификация synthesis: primary ollama (быстро+локально).
  | 'orchestrator-plan'
  | 'orchestrator-subagent'
  | 'orchestrator-synthesize'
  | 'orchestrator-verify'
  // SBA δ-2 — ProactiveWatcher.
  // 'proactive-message-craft' — короткое friendly-сообщение по сработавшему
  //   правилу (не «АЛЕРТ», а «привет, заметил X — может посмотришь?»).
  //   Primary = ollama qwen3.5:9b (дёшево, локально, частые вызовы).
  | 'proactive-message-craft'
  // SBA Wave 2 — Specialist 3.8 (Helpfulness Agent).
  // 'helpfulness-detect' — из IdeaBlock извлекает helpfulness trait'ы
  //   (help_provided | proactive_hint | mentoring | emotional_support |
  //    constructive_feedback | question_unanswered | question_acknowledged_no_action).
  //   Primary = DeepSeek; secondary = OpenAI gpt-4o-mini; tertiary = Ollama qwen3.5:9b.
  // 'helpfulness-trait-merge' — арбитр merge/keep_separate для KNN-кандидата
  //   с похожим topicHint. Аналогичная цепочка.
  // 'helpfulness-spotlight-formulate' — тёплое короткое «спасибо» для публичной
  //   ленты. Нужна capable модель (DeepSeek pro / gpt-4o), чтобы текст не казённый.
  | 'helpfulness-detect'
  | 'helpfulness-trait-merge'
  | 'helpfulness-spotlight-formulate'
  // Wave 2 — Recognition Agent.
  // 'recognition-formulate' — формулировка благодарственного сообщения по
  //   контексту (thanks/idea_shipped/streak/weekly_summary). Короткое, тёплое,
  //   без официоза. Primary = deepseek-v4-flash; secondary = openai gpt-5.4-mini;
  //   tertiary = ollama qwen3.5:9b. Никогда от имени руководителя —
  //   только от имени AI / системы.
  | 'recognition-formulate'
  // Wave 3 / Tracker Phase 3 part C — AI-suggest при создании задачи.
  // 'issue-infer-fields' — LLM по title+description+project-context →
  //   { suggestedAssigneeId?, suggestedDueDate?, suggestedPriority?,
  //     suggestedGoalId?, suggestedLabels?, confidence }.
  // 'issue-goal-suggest' — fallback после KNN: LLM выбирает Goal из списка
  //   активных целей tenant'а под title+description задачи.
  // Primary = deepseek; secondary = openai gpt-4o-mini; tertiary = ollama qwen3.5:9b.
  | 'issue-infer-fields'
  | 'issue-goal-suggest'
  // Wave 3 / Tracker Phase 3 part B — автозадачи из встреч + auto-triage Intake.
  // 'meeting-extract-actions' — извлекает структурированные задачи из
  //   транскрипта встречи (title + suggestedAssigneeHint + suggestedDueDate +
  //   suggestedPriority + confidence + sourceQuote). Capable модель;
  //   primary = deepseek-chat, secondary = openai gpt-4o-mini, tertiary = qwen3.5:9b.
  // 'intake-auto-triage' — для нового IntakeIssue заполняет suggested*
  //   поля + confidence. При confidence ≥ 0.92 + source='meeting' +
  //   suggestedAssigneeId IS NOT NULL → IntakeAutoTriageWorker создаёт
  //   Issue автоматически. Те же три уровня цепочки.
  | 'meeting-extract-actions'
  | 'intake-auto-triage'
  // Wave 3 / Tracker Phase 4 РФ part 1 — Telegram-бот для задач.
  // 'telegram-create-task' — парсер «одной фразы»: пользователь пишет боту
  //   в личке, LLM извлекает title + suggestedAssigneeHint + suggestedDueDate +
  //   suggestedProjectHint + confidence + sourceQuote. Primary = deepseek,
  //   secondary = openai gpt-4o-mini, tertiary = ollama qwen3.5:9b.
  // 'telegram-forward-to-task' — forward стороннего сообщения боту: то же
  //   извлечение, но из чужого текста (форварды длиннее, sourceQuote — целая
  //   цитата). Та же цепочка.
  // 'telegram-reply-classify' — короткая классификация reply на bot-уведомление
  //   (status_command | comment | new_task). Primary = ollama (дёшево +
  //   локально), secondary = deepseek, tertiary = openai gpt-4o-mini.
  // 'telegram-digest-formulate' — утренний дайджест: на входе агрегат
  //   { urgentToday, inProgress, overdue }, на выходе тёплый markdown.
  //   Primary = deepseek, secondary = openai gpt-4o-mini, tertiary = ollama.
  | 'telegram-create-task'
  | 'telegram-forward-to-task'
  | 'telegram-reply-classify'
  | 'telegram-digest-formulate'
  // ТЗ 2026-05-25 (meeting-report-split-from-block-ingest) — Фаза 1.
  // 'meeting-report-fast' — ОДИН LLM-вызов поверх СЫРОГО транскрипта,
  //   возвращает { chapters, tasks, summary_markdown, quality_score } через
  //   tool_use для «быстрого» пользовательского отчёта (заменил снятый с
  //   эксплуатации v2-стек). Capable модель + большой выход + thinking.
  //   Primary = deepseek-v4-pro; secondary = gpt-5.4-mini; tertiary = ollama qwen3.5:9b.
  | 'meeting-report-fast'
  // ТЗ 2026-05-25 llm-architecture §3 — Specialists Combined (Variant Б+).
  // 'knowledge-specialists-combined' — ОДИН LLM-вызов на ВСЕ блоки одной
  //   встречи, возвращает 8 типов сущностей через tool `submit_all_8_entities`:
  //   decisions/ideas/insights/experiments/regulations/knowledge_categories/
  //   skill_traits/helpfulness_traits. Заменяет 8 раздельных вызовов
  //   специалистов 3-1..3-9 (в 3.7× дешевле, 18:13 по качеству).
  //   Capable + большой выход + thinking. Primary = deepseek-v4-pro;
  //   secondary = gpt-5.4 (proxy); tertiary = ollama qwen3.5:9b.
  | 'knowledge-specialists-combined'
  // KC-Temporal W1.2 (2026-05-25) — FactSupersedeService.
  // 'fact-supersede-detect' — арбитр { unrelated | extends | contradicts |
  //   supersedes } по новому factual-блоку и top-K KNN кандидатам с тем же
  //   signalType. На supersedes — старый блок получает validUntil=now,
  //   создаётся IdeaBlockLink(relationType='supersedes') + ConflictItem.
  //   Дешёвый арбитр (≤700 input + ≤300 output): primary deepseek-v4-flash,
  //   secondary openai gpt-5.4-mini, tertiary ollama qwen3:30b.
  | 'fact-supersede-detect'
  // Sprints (2026-05-27, plans/tz/2026-05-27-sprints.md) — Specialist 3-13
  // (Помощник по спринтам).
  // 'sprint-helper-suggest' — главный вызов воркера 3-13: на входе контекст
  //   спринта (название/scope/даты + задачи с боардами/чек-листами +
  //   последние блоки графа + история уже выданных подсказок), на выходе
  //   массив SprintHint{kind,severity,title,body,affectedIssueIds[],confidence}.
  //   Capable модель с JSON Schema strict.
  //   Primary = deepseek-v4-pro; secondary = openai gpt-5.4-mini; tertiary = ollama qwen3.5:9b.
  // 'sprint-review-summary' — финальный отчёт спринта при завершении (хук
  //   CyclesService.complete + endpoint regenerate). Нарратив 3-5 предложений +
  //   план/факт + причины + переносы + блокеры + подсказки + кандидаты следующего спринта.
  //   Та же цепочка провайдеров.
  | 'sprint-helper-suggest'
  | 'sprint-review-summary'
  // ТЗ 2026-05-25 user-feedback-with-ai-clustering (Фаза 4) —
  // канал «Ваши предложения». 'feedback.cluster' — ночной batch-агент:
  //   на вход messages[] + existingTopics[], на выход newTopics[] + assignments[]
  //   (один тезис → один топик; жалоба/запрос/благодарность — часть смысла,
  //   не отдельное измерение). Capable модель + structured JSON:
  //   primary = deepseek-v4-pro, secondary = openai gpt-5.4,
  //   tertiary = kie gemini-3-pro, quaternary = grsai gemini-3-pro.
  | 'feedback.cluster'
  // Agents v2 Фаза B1 (2026-05-30) — AutoRule extract (shadow).
  // 'autorule-extract' — извлечение правила из группы пар (original, edited)
  //   AI-output'ов одного типа. Capable nuanced арбитр: primary = deepseek-v4-pro,
  //   secondary = openai-via-proxy/gpt-5.4, tertiary = ollama/qwen3:30b
  //   (НЕ qwen3.5:9b — слишком слабая для extraction паттернов).
  //   См. plans/tz/2026-05-29-agents-v2-umbrella.md §B1.
  | 'autorule-extract'
  // Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer (shadow).
  // 'concierge-step-prm' — оценивает, насколько конкретный кандидат tool_call
  //   приблизит к цели пользователя. Дешёвый scorer (≤500 input + ≤300 output):
  //   primary = deepseek-v4-flash; secondary = openai-via-proxy/gpt-5.4-mini;
  //   tertiary = ollama/qwen3.5:9b (cheap scoring — qwen3.5:9b приемлем как
  //   safety-net в отличие от nuanced extraction задач Фазы B1).
  //   См. plans/tz/2026-05-29-agents-v2-umbrella.md §B2.
  | 'concierge-step-prm'
  // Agents v2 Фаза C1 (2026-05-30) — PracticeSkill (выполняемые навыки клонов).
  // 'practice-skill-extract' — capable nuanced extractor: на входе SkillTraitConcept +
  //   связанные SkillTrait + reasoning-блоки employee'я; на выходе draft
  //   PracticeSkill {trigger, steps[], redFlags[]} либо null. Primary = deepseek-v4-pro,
  //   secondary = openai-via-proxy/gpt-5.4, tertiary = ollama/qwen3:30b
  //   (capable safety-net, не qwen3.5:9b — слишком слабая для извлечения steps).
  // 'practice-skill-adversarial-verify' — дешёвая верификация: проверяет, что
  //   ответ clone не нарушает redFlags skill'а и не противоречит SkillTrait'ам.
  //   Primary = deepseek-v4-flash; secondary = gpt-5.4-mini; tertiary = qwen3.5:9b
  //   (cheap binary verdict, qwen3.5:9b приемлем).
  //   См. plans/tz/2026-05-29-agents-v2-umbrella.md §C1.
  | 'practice-skill-extract'
  | 'practice-skill-adversarial-verify'
  // Pulse Wave 3 (2026-05-30, plans/tz/2026-05-30-pulse-full.md §3.1/3.5/3.7) —
  // 3 LLM-агента дашбордовой Волны 3 (engagement-scorer без LLM, чисто SQL).
  // 'team-health-analyzer'        — JSON-strict factors (5 осей low/medium/high) +
  //                                  summary. Capable не нужна — рутинная классификация.
  //                                  Primary deepseek-v4-flash; secondary gpt-5.4-mini;
  //                                  tertiary ollama qwen3.5:9b.
  // 'reflection-quality-scorer'    — JSON-strict 3-axis оценка (depth/concreteness/
  //                                  variety). Очень частый дешёвый вызов.
  //                                  Та же цепочка.
  // 'hr-recommender'              — 0..3 рекомендаций руководителю по сотруднику
  //                                  (praise/comp_review/workload/dev/urgent_talk).
  //                                  Нужна capable модель (нюансы).
  //                                  Primary deepseek-v4-pro; secondary gpt-5.4-mini;
  //                                  tertiary ollama qwen3.5:9b.
  | 'team-health-analyzer'
  | 'reflection-quality-scorer'
  | 'hr-recommender'
  // Pulse Wave 4 §4.4 (2026-05-30, plans/tz/2026-05-30-pulse-full.md §4.4) —
  // Meeting-Speaker-Analyzer: per-speaker TEXT sentiment + topics из реплик
  // спикера за встречу. JSON-strict, дешёвая классификация.
  // EU AI Act §1.3: НЕ анализирует голос/видео — только текст транскрипта.
  // Primary deepseek-v4-flash; secondary gpt-5.4-mini; tertiary ollama qwen3.5:9b.
  | 'meeting-speaker-analyzer'
  // Pulse Wave 4 §4.6 (2026-05-30) — Forecaster: weekly прогноз компании на
  // основе 4-недельных трендов 4 метрик. JSON-strict, capable модель
  // (deepseek-v4-pro primary, openai-via-proxy gpt-5.4 fallback, ollama
  // qwen3.5:9b tertiary). EU AI Act: только структурированные метрики, без
  // текстов сотрудников.
  | 'forecast-weekly'
  // Pulse Wave 5 §5.1 (2026-05-30, plans/tz/2026-05-30-pulse-full.md §5.1) —
  // SprintAnalyst.getDailyDigest: связный нарратив AI Daily Standup из
  // структурированных метрик дня спринта (прогресс, риски, активность).
  // Cache-friendly, без strict JSON — модель отдаёт markdown 4-6 абзацев.
  // Primary deepseek-v4-flash (дёшево, быстро); fallback gpt-5.4-mini.
  | 'sprint-daily-digest'
  // Pulse Wave 5 §5.2 (2026-05-30) — SprintAnalyst.getWeeklyDigest: связный
  // weekly summary спринта (recap гипотезы, velocity, обучения). Cache-friendly,
  // markdown без strict JSON. Primary deepseek-v4-flash.
  | 'sprint-weekly-digest'
  | 'issue-progress-draft'
  | 'issue-activity-digest'
  // Pulse Wave 6 §6.6 (2026-05-30) — Goal-Vector-Tracker: per-Goal LLM
  // анализ артефактов (idea / commitment kept|broken / issue closed) и
  // вычисление pro/contra/net score per Person. JSON-strict, дёшево
  // (deepseek-v4-flash primary). Cache-friendly: SYSTEM статичен, переменные
  // данные (goal + artefacts) — в конце user.
  | 'goal-vector-tracker'
  // Pulse Wave 6 §6.8 (2026-05-30) — Decision-Hygiene-Scorer: Bezos two-way
  // door classification (type-1 = необратимое; type-2 = обратимое).
  // JSON-strict, дешёвый частый вызов (вход — statement + alternatives;
  // выход — { reversibility, rationale }). Primary deepseek-v4-flash;
  // secondary gpt-5.4-mini; tertiary ollama qwen3.5:9b. Cache-friendly:
  // SYSTEM статичен, переменные данные (statement) — в конце user.
  | 'decision-hygiene'
  // Smart-tables auto-creation (2026-06-02, Фаза 1) — Text-to-Schema.
  // 3 LLM-pass'а генерации схемы Smart-таблицы по NL-описанию пользователя:
  //   'table-infer-schema'    — DRAFT: NL -> черновик схемы. JSON object.
  //   'table-architect-pass'  — ARCHITECT-рефлексия (дедуп колонок, типы, 1 isPrimary).
  //   'table-entity-check'    — сопоставление entitySync.type с доступными; нет -> null.
  // Capable модель + JSON object. Primary = deepseek deepseek-v4-pro
  // (тот же capable-профиль, что у skill-trait-detect / sprint-helper-suggest).
  // Cache-friendly: SYSTEM (каталог типов/правила) стабилен, переменное в USER.
  | 'table-infer-schema'
  | 'table-architect-pass'
  | 'table-entity-check'
  // Smart-tables auto-creation (2026-06-02, Фаза 3) — Event-to-Cells.
  //   'table-extract-rows' — извлечение фактов по схеме колонок из транскрипта.
  //   'table-auto-fill'    — рекомендация значения для одной ячейки.
  // Дешёвые частые задачи → primary deepseek-v4-flash (cheap tier). JSON object.
  // Cache-friendly: SYSTEM (роль + каталог типов + правила) стабилен, переменное в USER.
  | 'table-extract-rows'
  | 'table-auto-fill'
  // Smart-tables auto-creation (2026-06-02, Фаза 5) — NL Saved Views.
  //   'table-semantic-filter' — NL-запрос пользователя → JSON-фильтр таблицы.
  // Дешёвая частая задача → primary deepseek-v4-flash (cheap tier). JSON object.
  // Cache-friendly: SYSTEM (роль + каталог операторов + правила) стабилен, переменное
  // (колонки таблицы + дата + запрос) — в USER.
  | 'table-semantic-filter'
  // Goals OKR v2 (2026-06-02, Фаза 2) — Specialist 3-14 (Goals).
  //   'goal-extract'           — из IdeaBlock (commitment/plan_item) → черновик
  //     Goal (outcome-формулировка + горизонт + опц. измеримый KR). Может вернуть
  //     isGoal=false (не цель). Capable: primary deepseek-v4-pro.
  //   'goal-hierarchy-link'    — арбитр {duplicate|child_of|standalone} по KNN
  //     top-5 существующим целям. Дешёвый: primary deepseek-v4-flash.
  //   'goals-pulse-summarize'  — связный текст еженедельного пульса целей (Фаза 4).
  //     Как operations-daily-digest.
  | 'goal-extract'
  | 'task-extract'
  | 'goal-hierarchy-link'
  | 'goals-pulse-summarize'
  // ChatBox integration (ТЗ 2026-06-05, Фаза 5) — LLM-summary сессии чата.
  | 'chatbox-summary'
  // Ф5 Р2 (2026-06-08) — task-dedupe: семантический арбитр совпадения двух
  // задач встречи (action items). KNN-«серая зона»: один вызов на пару
  // (fast-черновик, canonical-задача), вердикт same|different. РИСКОВО (может
  // скрыть задачу) → за флагом DEFAULT OFF; при сомнении → 'different'.
  // Дешёвый арбитр: primary deepseek-v4-flash; secondary gpt-5.4-mini;
  // tertiary ollama qwen3.5:9b. Cache-friendly: SYSTEM статичен, две задачи в USER.
  | 'task-dedupe'
  // TZ task-dedup (2026-06-16) — task-dedup-arbiter: дедуп задачи ПЕРЕД записью
  // в трекер. Вход — кандидат + KNN-похожие открытые задачи; вердикт
  // nil|same|different (NIL первым, защита от «лепим к top-1»). Только SUGGEST —
  // авто-merge запрещён (R13). Дешёвый арбитр CHEAP_CHAIN: primary
  // deepseek-v4-flash. Cache-friendly: SYSTEM статичен, кандидат+список в USER.
  | 'task-dedup-arbiter'
  // TZ task-dedup (2026-06-16, Ф2) — task-closure-verify: верификатор «правда ли
  // задача выполнена» по сигналу из разговора. Вход — текст задачи + цитата из
  // разговора; выход { done, confidence, rationale, positiveSignals[],
  // negativeSignals[] }. Только КАНДИДАТ на закрытие, авто-закрытие запрещено
  // (R13). Анти-инъекция: реплика оборачивается wrapUserData/withInjectionGuard.
  // Дешёвый верификатор CHEAP_CHAIN: primary deepseek-v4-flash. Cache-friendly:
  // SYSTEM статичен, задача+цитата в КОНЦЕ user.
  | 'task-closure-verify'
  // Ф4.1 agent-chain-overhaul (2026-06-08) — goal-task-link: батч-арбитр
  // авто-привязки задач встречи к AI-цели. Один вызов на цель: цель + список
  // ungoaled-задач встречи → по каждой { develops, confidence }. Non-destructive
  // (ставит Issue.goalId только где null). РИСКОВО (мис-атрибуция) → за флагом
  // goals.goalTaskLinkEnabled DEFAULT OFF; при сомнении develops=false. Дешёвый:
  // primary deepseek-v4-flash. Cache-friendly: SYSTEM статичен, цель+задачи в USER.
  | 'goal-task-link'
  // ТЗ-4 Ф10 (manual-document-upload) — document-attribution-suggest: подсказка
  // атрибуции загруженного документа (смысловой тип docType + тема графа). Один
  // вызов на документ без явной атрибуции (docType=null И attachedThemeId=null):
  // первые ~2000 символов parsedText + список тем Org → { docType, themeId|null,
  // confidence }. Результат пишется в Document.suggested* (человек подтверждает,
  // авто-применения НЕТ — Р3). Дешёвый классификатор: primary deepseek-v4-flash.
  // Cache-friendly: SYSTEM статичен (инструкция + enum DocumentType + JSON-форма),
  // переменное (текст + темы) в КОНЦЕ user.
  | 'document-attribution-suggest'
  // Слой источника Ф8 (2026-06-27) — document-summarize: AI-заголовок + резюме
  // загруженного документа из parsedText (cache-friendly: стабильный SYSTEM,
  // текст в конце user). Дешёвый, едет по DEFAULT_FALLBACK_CHAIN, best-effort.
  | 'document-summarize'
  // Волна 4 B0 (2026-06-10) — client-meeting-split: нейтральный ПРОТОКОЛ встречи
  // НАРУЖУ для клиента (free-text Markdown, как summary; без tool/JSON-схемы).
  // Запускается в analyze.worker для клиентских типов (sales/customer_success/
  // partner/custdev), результат — AiResult.structuredData.client_protocol_md.
  // Граница D6: ноль внутренних оценок. DEFAULT-маршрут (без strict-json), за
  // kill-switch clientProtocolEnabled (дефолт ON). Cache-friendly: SYSTEM
  // статичен, диалог+участники+дата в КОНЦЕ user.
  | 'client-meeting-split'
  // Волна 6 Стадия C, A7 (2026-06-10) — structured-document-compiler.
  // 'compile-org-document' — единый агент-компилятор `contentMd` орг-документа
  //   (regulation/process/policy/instruction). Вызывается после
  //   regulation-dedupe на verdict merge/extension: собирает структурный
  //   документ по шаблону типа (режимы СОЗДАНИЕ/ДОПОЛНЕНИЕ, маркеры) через tool
  //   `compile_org_document` → { contentMd, steps, changeReason, signals }.
  //   Capable модель + tool-use. Primary = deepseek-v4-pro; secondary = gpt-5.4
  //   (proxy); tertiary = ollama qwen3.5:9b (см. seed-маршрут). За kill-switch
  //   docCompilerEnabled (дефолт ON).
  | 'compile-org-document'
  // Единый чат Ф5b (2026-06-28) — chat-summary «Что пропустил»: сводка
  //   непрочитанной переписки разговора с цитатами [MSG:<id>]. Стабильный
  //   SYSTEM, переменное (непрочитанные сообщения) в КОНЦЕ user (prompt
  //   caching). Дешёвая задача — primary deepseek-v4-flash, secondary
  //   openai-via-proxy.
  | 'chat-summary';

/**
 * Полный кортеж всех `LlmTaskType` — единый источник правды для DTO admin'а.
 * Должен совпадать с union'ом выше, добавляются новые taskType ОДНОВРЕМЕННО
 * в обоих местах. tsc предупредит при несоответствии (через `satisfies`-trick
 * не делаем — TS пока без `Exhaustive<T>` helper'а на runtime-tuple).
 */
export const ALL_LLM_TASK_TYPES: readonly LlmTaskType[] = [
  'summary',
  'chapters',
  'tasks',
  'chat',
  'regenerate-section',
  'custom-prompt',
  'follow-up',
  'clip-title',
  'card-rollup',
  'card-chat',
  'block-ingest',
  'chunk-context',
  'block-distill',
  'block-linker',
  'entity-resolver',
  'entity-merge-arbiter',
  'entity-name-resolve',
  'block-link-confirm',
  'rag-route',
  'rag-plan',
  'rag-rerank',
  'rag-sufficiency',
  'rag-groundedness',
  'entity-graph-builder',
  'theme-classify',
  // Ф8 граф-ингест (2026-06-23) — инкрементальная суть темы/кластера.
  'theme-summarize',
  'reframing',
  'card-rollup-v2',
  'chat-v2',
  'goal-alignment',
  'dashboard-summary',
  'role-profile-build',
  'transcript-clean-refine',
  'behavior-refine',
  'meeting-quality-score',
  'custom-report',
  'chat-v2-cite-select',
  'chat-v2-conversation-title',
  // Редизайн кабинета Ф5а (2026-06-13) — авто-название встречи.
  'meeting-title',
  // SBA α-7
  'regulation-extract',
  'regulation-dedupe',
  // SBA β-2
  'knowledge-clone-extract',
  'knowledge-clone-merge',
  // SBA β-3
  'decision-extract',
  'decision-supersede-detect',
  // SBA β-4
  'insight-extract',
  'insight-link-to-decisions',
  // SBA β-5
  'idea-extract',
  'idea-cluster-merge',
  'probe-formulate',
  'idea-status-summarize',
  // Agents v2 Фаза 0.1 (2026-05-30) — Probe-Response-Classify.
  'probe-response-classify',
  // Probe Фаза 2 (2026-06-17) — LLM-судья качества формулировки probe-вопроса.
  'probe-quality-judge',
  'probe-value-gate',
  'probe-draft-from-memory',
  'subject-memory-rule-extract',
  'subject-memory-judge',
  'company-summary-compile',
  'task-assignee-arbiter',
  // Agents v2 Фаза A2 (2026-05-30) — Multi-Agent Debate.
  'debate-decision-supersede',
  'debate-decision-supersede-critic',
  'debate-decision-supersede-supporter',
  'debate-decision-supersede-neutral',
  // Action Center A1 «лестница доверия» (2026-06-02) — Curation-Verify debate.
  'debate-curation-verify',
  'debate-curation-verify-critic',
  'debate-curation-verify-supporter',
  'debate-curation-verify-neutral',
  // Autonomy W1 (2026-06-12) — Conflict-Arbiter debate (LLM-арбитр конфликтов).
  'debate-conflict-arbiter',
  'debate-conflict-arbiter-critic',
  'debate-conflict-arbiter-supporter',
  'debate-conflict-arbiter-neutral',
  // SBA γ-1
  'skill-trait-detect',
  'skill-trait-merge',
  'skill-trait-verify',
  'executable-persona-compile',
  'clone-respond',
  // ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2
  'skill-trait-concept-name',
  // TZ clone-method Э1.2 — Reflection-слой принципов роли
  'role-principle-synthesize',
  // TZ clone-method Э1.3 — детектор ценностей/мотивации из trade-off, дешёвый частый — flash
  'value-motivation-detect',
  // TZ clone-method Э2.1 — детектор маркеров процесса (clone-method Э2.1), дешёвый — flash
  'process-marker-detect',
  // TZ clone-method Э3.1 — формулировка CDM-вопроса по кейсу (clone-method Э3.1), редкий — capable
  'cdm-case-interview',
  // TZ clone-method ВАЛ.1 — LLM-judge поведенческой верности клона (clone-method ВАЛ.1), дешёвый — flash
  'persona-behavior-judge',
  // dialog-layer (ТЗ 2026-06-14: контекстуализатор+оценщик слиты в dialog-multi-query)
  'dialog-classify',
  'dialog-multi-query',
  'dialog-summarize',
  // Query Understanding Волна 1 (ТЗ 2026-06-10 Tier 0)
  'dialog-extract-plan',
  // Ф4b (edinyy-pomoshnik) — слитый модуль понимания (queries + план)
  'dialog-understand',
  // Support desk Ф3 (support-desk-clone)
  'support-clone-draft',
  'support-answer-critic',
  'support-edit-classify',
  // Support desk Ф4 (support-desk-clone) — ночной куратор контура
  'support-contour-curate',
  // SBA α-7 wave 2
  'process-template-extract',
  // SBA α-3 wave 3
  'axis-classify',
  'router-fallback',
  // SBA β-7
  'brand-voice-extract',
  // SBA γ-3
  'cross-functional-friction-summary',
  // SBA α-8 wave 4 — Role Map
  'role-map-extract',
  'role-completeness-rationale',
  // SBA γ-2 — Concierge Agent
  'concierge-respond',
  'concierge-toolcall-validate',
  // Ф6 assistant-channels — текст-подтверждение мутаций в каналах
  'assistant-confirm-classify',
  // SBA β-8 — DailyCheckIn + Operations
  'checkin-parse',
  'operations-summary',
  // SBA β-8.1 — добивка панели операционного директора
  'checkin-sentiment',
  'day-signal-detect',
  'operations-weekly-digest',
  // SBA β-8.3 — ежедневный отчёт COO
  'operations-daily-digest',
  // «Месяц компании» — свод 4 недель в месячный брифинг
  'operations-monthly-digest',
  // TZ-1 Фаза 1 (daily-value-engine) — Радар клиентов под риском
  'customer-risk-digest',
  // TZ-1 Фаза 2 (daily-value-engine) — движок рядового «Твой день»
  'personal-brief-hint',
  // TZ-1 Фаза 3.A (daily-value-engine) — накопительный синтез блокеров
  'blocker-synthesis-summary',
  // TZ-1 Фаза 5 (daily-value-engine) — месячная витрина value-recap
  'value-recap-narrative',
  // SBA β-8.2 — Promise Keeper
  'commitment-extract-dates',
  'commitment-extract-status',
  // SBA δ-1 — Orchestrator
  'orchestrator-plan',
  'orchestrator-subagent',
  'orchestrator-synthesize',
  'orchestrator-verify',
  // SBA δ-2 — ProactiveWatcher
  'proactive-message-craft',
  // SBA Wave 2 — Specialist 3.8 Helpfulness Agent
  'helpfulness-detect',
  'helpfulness-trait-merge',
  'helpfulness-spotlight-formulate',
  // Wave 2 — Recognition Agent
  'recognition-formulate',
  // Wave 3 / Tracker Phase 3 part C — AI-suggest при создании задачи
  'issue-infer-fields',
  'issue-goal-suggest',
  // Wave 3 / Tracker Phase 3 part B
  'meeting-extract-actions',
  'intake-auto-triage',
  // Wave 3 / Tracker Phase 4 РФ part 1 — Telegram-бот для задач
  'telegram-create-task',
  'telegram-forward-to-task',
  'telegram-reply-classify',
  'telegram-digest-formulate',
  // ТЗ 2026-05-25 — meeting-report-fast (Фаза 1).
  'meeting-report-fast',
  // ТЗ 2026-05-25 KC-Temporal W1.2 — FactSupersedeService.
  'fact-supersede-detect',
  // ТЗ 2026-05-25 user-feedback-with-ai-clustering (Фаза 4).
  'feedback.cluster',
  // Sprints (2026-05-27) — Specialist 3-13 (Помощник по спринтам).
  'sprint-helper-suggest',
  'sprint-review-summary',
  // Agents v2 Фаза B1 (2026-05-30) — AutoRule extract (shadow).
  'autorule-extract',
  // Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer (shadow).
  'concierge-step-prm',
  // Agents v2 Фаза C1 (2026-05-30) — PracticeSkill (выполняемые навыки клонов).
  'practice-skill-extract',
  'practice-skill-adversarial-verify',
  // Pulse Wave 3 (2026-05-30) — 3 LLM-агента дашбордовой Волны 3.
  'team-health-analyzer',
  'reflection-quality-scorer',
  'hr-recommender',
  // Pulse Wave 4 (2026-05-30) — Meeting-Speaker-Analyzer (per-speaker text sentiment).
  'meeting-speaker-analyzer',
  // Pulse Wave 4 §4.6 (2026-05-30) — Forecaster: weekly прогноз компании.
  'forecast-weekly',
  // Pulse Wave 5 §5.1-5.2 (2026-05-30) — связные нарративы daily/weekly спринта.
  'sprint-daily-digest',
  'sprint-weekly-digest',
  'issue-progress-draft',
  'issue-activity-digest',
  // Pulse Wave 6 §6.6 (2026-05-30) — Goal-Vector-Tracker: pro/contra/net per (person, goal).
  'goal-vector-tracker',
  // Pulse Wave 6 §6.8 (2026-05-30) — Decision-Hygiene-Scorer: Bezos type-1/type-2.
  'decision-hygiene',
  // Smart-tables auto-creation (2026-06-02, Фаза 1) — Text-to-Schema (3 pass).
  'table-infer-schema',
  'table-architect-pass',
  'table-entity-check',
  // Smart-tables auto-creation (2026-06-02, Фаза 3) — Event-to-Cells (cheap).
  'table-extract-rows',
  'table-auto-fill',
  // Smart-tables auto-creation (2026-06-02, Фаза 5) — NL Saved Views (cheap).
  'table-semantic-filter',
  // Goals OKR v2 (2026-06-02, Фаза 2) — Specialist 3-14 (Goals).
  'goal-extract',
  'task-extract',
  'goal-hierarchy-link',
  'goals-pulse-summarize',
  // ChatBox integration (ТЗ 2026-06-05, Фаза 5) — LLM-summary сессии чата.
  'chatbox-summary',
  // Закрытие дыры реестра (2026-06-05): объявлены в типе LlmTaskType, но
  // отсутствовали в этом массиве → не попадали в /admin/ai-models и в сиды,
  // ехали по аварийному DEFAULT_FALLBACK_CHAIN. См. ТЗ 2026-06-05-llm-router-resilience.
  'knowledge-specialists-combined',
  'dialog-multi-query-clone',
  'checkin-sentiment-batch',
  // Дыра оказалась шире (найдено при реализации 2026-06-05): Specialist 3.9
  // тоже не был зарегистрирован.
  'experiment-extract',
  'experiment-summarize-lessons',
  // Ф5 Р2 (2026-06-08) — task-dedupe (семантический дедуп задач встречи).
  'task-dedupe',
  // TZ task-dedup (2026-06-16) — task-dedup-arbiter (дедуп задачи перед записью
  // в трекер; nil|same|different, только suggest, авто-merge запрещён).
  'task-dedup-arbiter',
  // TZ task-dedup (2026-06-16, Ф2) — task-closure-verify (верификатор «выполнена
  // ли задача» по сигналу из разговора; только обратимый кандидат, R13).
  'task-closure-verify',
  // Ф4.1 agent-chain-overhaul (2026-06-08) — goal-task-link (авто-привязка
  // задач встречи к AI-цели, DEFAULT OFF).
  'goal-task-link',
  // ТЗ-4 Ф10 (2026-06-09) — document-attribution-suggest (подсказка docType +
  // темы для загруженного документа без явной атрибуции; human-in-the-loop).
  'document-attribution-suggest',
  // Слой источника Ф8 (2026-06-27) — document-summarize (AI-заголовок + резюме
  // документа из parsedText; DEFAULT-маршрут, best-effort).
  'document-summarize',
  // Волна 4 B0 (2026-06-10) — client-meeting-split (нейтральный протокол встречи
  // наружу для клиента, free-text; DEFAULT-маршрут, за kill-switch ON).
  'client-meeting-split',
  // Волна 6 Стадия C, A7 (2026-06-10) — compile-org-document (агент-компилятор
  // contentMd орг-документа; tool-use, capable; за kill-switch docCompilerEnabled ON).
  'compile-org-document',
  // Единый чат Ф5b (2026-06-28) — chat-summary («Что пропустил»: сводка
  // непрочитанной переписки с цитатами [MSG:<id>]; стабильный SYSTEM, дешёвый).
  'chat-summary',
] as const;

/**
 * Имя провайдера, как оно хранится в `LlmTaskRoute.providers` (JSON-массив).
 * Для каждого провайдера в свитче ниже — соответствующий сервис.
 */
export type LlmProviderName =
  | 'anthropic'
  | 'minimax'
  | 'openai-via-proxy'
  | 'deepseek'
  | 'ollama'
  | 'kie'
  | 'grsai';

const ALL_PROVIDERS: LlmProviderName[] = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
  'kie',
  'grsai',
];

/**
 * Фаза 11 knowledge-core: per-provider capability map.
 *   - maxDataClass — самый «строгий» класс данных, который провайдер согласен
 *     обрабатывать. public < internal < sensitive < private.
 *   - localOnly — провайдер живёт локально (никогда не уходит наружу).
 *
 * `anthropic` — прямой Anthropic API; для нас это «sensitive» (договор).
 *   Если ANTHROPIC_USE_PROXY=true — фактически идёт через сторонний прокси,
 *   но capability в текущем MVP мы не понижаем (отслеживается ENV-флагом).
 * `minimax` / `openai-via-proxy` / `deepseek` — внешние, internal-only.
 * `ollama` — локальный, формально может обрабатывать private.
 *
 * Карта намеренно жёсткая — config-driven вариант (через БД) — vNext.
 */
const PROVIDER_CAPABILITY: Record<
  LlmProviderName,
  { maxDataClass: DataClass; localOnly: boolean }
> = {
  anthropic: { maxDataClass: 'sensitive', localOnly: false },
  minimax: { maxDataClass: 'internal', localOnly: false },
  'openai-via-proxy': { maxDataClass: 'internal', localOnly: false },
  deepseek: { maxDataClass: 'internal', localOnly: false },
  ollama: { maxDataClass: 'private', localOnly: true },
  // KIE / GRSAI — внешние мульти-провайдер прокси (Claude/GPT/Gemini).
  // grsai пропускает только internal-данные; sensitive — никогда.
  // kie поднят до private (2026-06-05), т.к. стал универсальным tertiary;
  // приватность сейчас в деприоритете — решение владельца.
  kie: { maxDataClass: 'private', localOnly: false },
  grsai: { maxDataClass: 'internal', localOnly: false },
};

/**
 * Порядок DataClass: public < internal < sensitive < private.
 * Используется для `provider.maxDataClass >= dataClass` сравнения.
 */
const DATA_CLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  private: 3,
};

/**
 * @deprecated W4.2 KC-Temporal (2026-05-25) — используй
 *   `DataClassPolicyService.derive({ sources, context: { kind } })`.
 *
 * Возвращает «строжайший» из переданных DataClass'ов. Используется в
 * call-site'ах LLM-вызовов, где входных блоков/документов больше одного
 * (chat retrieval, distill judge, summary v2 и т.п.). Дефолт — 'internal'.
 *
 * Пустой/отсутствующий вход → 'internal' (чтобы вызовы без явного
 * dataClass не оказывались более строгими, чем нужно).
 *
 * Оставлено для legacy-вызовов вне knowledge-core (chat retrieval вне
 * specialist flow, summary v2). Новый код должен дёргать DataClassPolicyService.
 */
export function maxDataClass(
  classes: Array<DataClass | null | undefined>,
): DataClass {
  let best: DataClass = 'internal';
  for (const c of classes) {
    if (!c) continue;
    if (DATA_CLASS_RANK[c] > DATA_CLASS_RANK[best]) {
      best = c;
    }
  }
  return best;
}

const DEFAULT_FALLBACK_CHAIN: ProviderEntry[] = [
  { provider: 'deepseek', tier: 'primary' },
  { provider: 'openai-via-proxy', tier: 'secondary' },
  { provider: 'kie', model: 'gemini-3.1-pro', tier: 'tertiary' },
];

/**
 * Порядок tier'ов в цепочке fallback'а. primary всегда сначала, tertiary — последний.
 * Используется в `refreshCache()` для сортировки tier-нормализованных записей.
 */
const TIER_RANK: Record<LlmRouteTier, number> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
};

interface ProviderEntry {
  provider: LlmProviderName;
  model?: string;
  /**
   * Фаза A.4 — уровень в цепочке fallback'а. NULL = legacy запись (одноуровневая
   * цепочка, tier'ы не определены — пишем в AiUsageLog.tier как `primary` для
   * первого, `secondary` для второго и т.д. по позиции).
   */
  tier?: LlmRouteTier;
}

/**
 * Параметры эксперимента LlmTaskRoute.experiment.
 *
 *  - modelA / modelB — `<provider>:<model>` (например `deepseek:deepseek-v4-flash`).
 *  - splitPercent: доля трафика на A в процентах (0..100).
 *  - startedAt / endsAt — ISO-строки.
 */
interface ExperimentConfig {
  enabled?: boolean;
  modelA?: string;
  modelB?: string;
  splitPercent?: number;
  startedAt?: string;
  endsAt?: string;
}

interface PriceCacheEntry {
  inputPer1M: number;
  outputPer1M: number;
  cachedPer1M: number;
  fetchedAt: number;
}

/**
 * Agents v2 Фаза C2 — кэш активных PromptCandidate(status='testing').
 */
interface GepaCandidateEntry {
  promptKey: string;
  tenantId: string | null;
  promptText: string;
  abTrafficShare: number;
}

const PRICE_CACHE_TTL_MS = 60_000;

export interface LlmCallParams {
  taskType: LlmTaskType;
  systemPrompt: string;
  userMessage: string;
  /**
   * tenantId — обязательное поле (Фаза 0 knowledge-core).
   *
   * Все вызовы LLM должны быть атрибутированы Org для биллинга/аналитики.
   * Если caller не может определить tenantId (system jobs, scheduled tasks
   * без owner) — допустимо передать null явно, но это исключение.
   */
  tenantId: string | null;
  meetingId?: string;
  userId?: string;
  jobId?: string;
  /** Структурированный вывод. */
  responseFormat?: LlmResponseFormat;
  /** Усилия модели на reasoning (для gpt-5* и deepseek-v4-pro). */
  reasoningEffort?: LlmReasoningEffort;
  maxTokens?: number;
  /**
   * Если задан — переопределяет модель провайдера. Полезно для бенчмарков
   * (одна и та же задача → разные модели).
   */
  model?: string;
  /** Указатель на источник вызова для drill-down в Z-Admin (Фаза 7). */
  sourceRef?: { type: string; id: string } | null;
  /**
   * Класс данных вызова (Фаза 11 knowledge-core).
   *
   * Определяет, какие провайдеры могут обработать запрос: только те, у
   * которых `maxDataClass >= dataClass`. Если caller не передал —
   * считаем 'internal' (большинство business-данных).
   *
   * Источник:
   *   - воркеры над блоками — max(IdeaBlock.dataClass) по входным;
   *   - chat — max по retrieval pool;
   *   - meeting-уровень — наследуем из Meeting/RawEvent.
   */
  dataClass?: DataClass;
  /**
   * Tools для tool_use (function-calling). Если задан непустой массив —
   * провайдер получит `tools` + `tool_choice='auto'` (см. DeepSeekService /
   * OpenAiProxyService). Результирующие tool_calls попадут в
   * `LlmCallResult.toolCalls`.
   *
   * Используется в ТЗ 2026-05-25 `meeting-report-fast` для strict вывода
   * через tool `submit_meeting_analysis`.
   */
  tools?: LlmTool[];
  /** Опц. валидатор вывода. Если вернул false — router бросит LlmInvalidOutputError и попробует следующего провайдера. */
  validate?: (text: string) => boolean;
  /** Per-call hard-timeout на dispatch (ms). Если не задан — глобальный dispatchTimeoutMs. */
  timeoutMs?: number;
}

export interface LlmCallResult {
  text: string;
  /** Формат: `<provider>:<model>` (e.g. `deepseek:deepseek-v4-flash`). */
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  /**
   * Фаза A.4 — фактический tier цепочки, который отработал. Каждый caller,
   * которому это важно (например, ai.quality-score выставляет
   * `degradedMode=true` при `tier=tertiary` — sub-TZ C §5.4), может использовать
   * это поле без подмены ответа в LlmRouter. NULL для legacy/нестабильных
   * вызовов, где tier не определялся (тоже маловероятно после A.4).
   */
  tier?: LlmRouteTier | null;
  /** Имя провайдера, который реально ответил (в дополнение к `modelUsed`). */
  providerUsed?: string;
  /**
   * Tool calls, которые вернула модель при `params.tools` (function-calling).
   * Заполняется только провайдерами, поддерживающими tool_use
   * (DeepSeek/OpenAI/Anthropic/MiniMax/Ollama). Если tools не передавался —
   * undefined.
   */
  toolCalls?: LlmToolCall[];
}

export class LlmRouterAllProvidersFailedError extends Error {
  constructor(
    readonly taskType: LlmTaskType,
    readonly errors: Array<{ provider: string; message: string }>,
  ) {
    super(
      `LlmRouter: все провайдеры упали для taskType=${taskType}: ` +
        errors.map((e) => `${e.provider}=${e.message}`).join('; '),
    );
    this.name = 'LlmRouterAllProvidersFailedError';
  }
}

/**
 * Фаза 11: ни один провайдер не подходит под требуемый dataClass.
 * Бросается, когда `provider.maxDataClass < dataClass` для всех кандидатов.
 * Caller должен либо понизить dataClass (если это допустимо политикой
 * безопасности), либо подключить локальный провайдер.
 */
export class NoEligibleProviderError extends Error {
  readonly code = 'no_provider_for_data_class';
  constructor(
    readonly taskType: LlmTaskType,
    readonly dataClass: DataClass,
    readonly attemptedProviders: string[],
  ) {
    super(
      `LlmRouter: ни один провайдер не поддерживает dataClass='${dataClass}' для taskType='${taskType}'. ` +
        `Кандидаты: ${attemptedProviders.join(', ') || '(none)'}.`,
    );
    this.name = 'NoEligibleProviderError';
  }
}

/**
 * ТЗ LLM cost-safety Ф2: hard-cap бюджета тенанта превышен и enforce включён.
 * Бросается ДО dispatch к любому провайдеру. При observe (флаг выключен)
 * не бросается — только метрика + warn-лог.
 */
export class LlmBudgetExceededError extends Error {
  readonly code = 'llm_budget_exceeded';
  constructor(
    readonly tenantId: string | null,
    readonly mtdRub: number,
    readonly capRub: number | null,
  ) {
    super(
      `LlmRouter: бюджет тенанта превышен (MTD=${mtdRub}₽ ≥ cap=${capRub}₽), вызов заблокирован.`,
    );
    this.name = 'LlmBudgetExceededError';
  }
}

/**
 * Маршрутизатор LLM-вызовов по `LlmTaskRoute` записям из БД.
 *
 * - При старте подгружает все routes в in-memory кэш.
 * - Раз в минуту обновляет кэш (через `@Cron('*\/1 * * * *')`).
 * - На каждый вызов: подбирает providers по `taskType` (или дефолт),
 *   пробует последовательно. Успех — пишет в `AiUsageLog` + метрика
 *   `llm_router_dispatch_total{status='success'}`. Падение — переключение
 *   с метрикой `status='fallback'`. Все упали → `status='failed'` + exception.
 * - A/B-эксперименты через `LlmTaskRoute.experiment`: при `enabled=true`
 *   и в окне `[startedAt, endsAt)` — рандомно по `splitPercent` выбираем
 *   A или B и пишем `experimentGroup` в `AiUsageLog`.
 * - Цена считается по `LlmModelPrice` (БД); при отсутствии записи — fallback
 *   на `MODEL_PRICES` из кода. Цены кэшируются в памяти на 60 секунд.
 */
@Injectable()
export class LlmRouterService implements OnModuleInit {
  private readonly logger = new Logger(LlmRouterService.name);
  private routes = new Map<LlmTaskType, ProviderEntry[]>();
  /**
   * Хранится отдельно от `routes`: при `isActive=false` маршрут игнорируется
   * (используется дефолтная цепочка), но видим в `getRoutes()` для админ-UI.
   */
  private allRoutes: LlmTaskRoute[] = [];
  private priceCache = new Map<string, PriceCacheEntry>();

  /**
   * Agents v2 Фаза C2 — кэш активных PromptCandidate(status='testing'),
   * по которым выполняется A/B replacement systemPrompt'а. Обновляется тем
   * же refreshCache cron'ом (раз в минуту). Ключ: `${promptKey}::${tenantId|null}`.
   * Несколько кандидатов на один ключ не ожидаются (gepa-promote делает top-1),
   * но если вдруг — берём первый.
   */
  private gepaCandidates = new Map<string, GepaCandidateEntry>();

  /**
   * audit С30 (2026-05-29): timeout на один dispatch к провайдеру в ms.
   * Из ENV LLM_ROUTER_DISPATCH_TIMEOUT_MS, default 300000.
   */
  private get dispatchTimeoutMs(): number {
    return this.cfg?.llmRouter?.dispatchTimeoutMs ?? 300_000;
  }

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AnthropicService) private readonly anthropic: AnthropicService,
    @Inject(MinimaxService) private readonly minimax: MinimaxService,
    @Inject(OpenAiProxyService) private readonly openai: OpenAiProxyService,
    @Inject(DeepSeekService) private readonly deepseek: DeepSeekService,
    @Inject(OllamaService) private readonly ollama: OllamaService,
    @Inject(KieService) private readonly kie: KieService,
    @Inject(GrsaiService) private readonly grsai: GrsaiService,
    @Inject(AiUsageLogService) private readonly usage: AiUsageLogService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    // SBA α-10 wave 3 — Adapter Registry (feature-flag). Optional, чтобы тесты
    // без DI на регистре продолжали работать.
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(LlmProtocolAdapterRegistry)
    private readonly adapterRegistry?: LlmProtocolAdapterRegistry,
    @Optional()
    @Inject(ProviderInfoResolver)
    private readonly providerInfo?: ProviderInfoResolver,
    // Agents v2 Фаза B1 (2026-05-30) — эмит `ai.invocation.completed` для
    // PromptFeedbackCollectorService. @Optional — старые тесты с моком
    // LlmRouter без EventEmitter2 продолжают работать.
    @Optional()
    @Inject(EventEmitter2)
    private readonly events?: EventEmitter2,
    // ТЗ LLM cost-safety Ф2 — pre-dispatch budget gate. @Optional — тесты и
    // воркер-side без BudgetGuard в DI продолжают работать (gate тихо пропускается).
    @Optional()
    @Inject(BudgetGuardService)
    private readonly budgetGuard?: BudgetGuardService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshCache().catch((err) => {
      this.logger.warn(
        `onModuleInit: не удалось загрузить routes: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * Cron — каждую минуту синкает кэш с БД. Если админ изменил route через UI,
   * максимум 60 секунд до применения.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async refreshCacheTick(): Promise<void> {
    try {
      await this.refreshCache();
    } catch (err) {
      this.logger.warn(
        `refreshCacheTick: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Перечитать routes из БД. Вызывается из cron и из `setRoute` (немедленная
   * инвалидация после изменения).
   */
  async refreshCache(): Promise<void> {
    const all = await this.prisma.llmTaskRoute.findMany();
    this.allRoutes = all;
    const map = new Map<LlmTaskType, ProviderEntry[]>();

    // Фаза A.4 — нормализованные записи (tier NOT NULL) имеют приоритет.
    // Группируем по taskType, сортируем primary → secondary → tertiary,
    // внутри tier'а — по priority asc. Внутри одной (taskType, tier, providerName)
    // запись уже уникальна по @@unique.
    const tieredByTask = new Map<LlmTaskType, LlmTaskRoute[]>();
    for (const r of all) {
      if (!r.isActive) continue;
      if (r.tenantId !== null) continue; // org-overrides не входят в дефолт-кэш
      if (r.tier == null || r.providerName == null) continue;
      const list = tieredByTask.get(r.taskType as LlmTaskType) ?? [];
      list.push(r);
      tieredByTask.set(r.taskType as LlmTaskType, list);
    }
    for (const [taskType, list] of tieredByTask.entries()) {
      const sorted = list
        .slice()
        .sort((a, b) => {
          const ta = TIER_RANK[a.tier as LlmRouteTier];
          const tb = TIER_RANK[b.tier as LlmRouteTier];
          if (ta !== tb) return ta - tb;
          return a.priority - b.priority;
        })
        .filter((r) => (ALL_PROVIDERS as string[]).includes(r.providerName ?? ''))
        .map((r) => ({
          provider: r.providerName as LlmProviderName,
          ...(r.model ? { model: r.model } : {}),
          tier: r.tier as LlmRouteTier,
        }));
      if (sorted.length > 0) {
        map.set(taskType, sorted);
      }
    }

    // Legacy: для taskType'ов без tier-записей берём старую JSON-форму.
    for (const r of all) {
      if (!r.isActive) continue;
      if (r.tenantId !== null) continue;
      if (r.tier != null) continue; // нормализованные уже учли выше
      if (map.has(r.taskType as LlmTaskType)) continue; // tier-цепочка уже задана
      const providers = parseProviders(r.providers);
      if (providers.length === 0) continue;
      map.set(r.taskType as LlmTaskType, providers);
    }
    this.routes = map;

    // Agents v2 Фаза C2 — подкачка PromptCandidate(status='testing') для A/B.
    // Не критично если запрос упадёт (например, prod без новой колонки) —
    // просто A/B не включится. Best-effort.
    try {
      const candidates = await (this.prisma as unknown as {
        promptCandidate?: {
          findMany: (args: unknown) => Promise<
            Array<{
              promptKey: string;
              tenantId: string | null;
              promptText: string;
              abTrafficShare: number | null;
            }>
          >;
        };
      }).promptCandidate?.findMany({
        where: { status: 'testing' },
        select: {
          promptKey: true,
          tenantId: true,
          promptText: true,
          abTrafficShare: true,
        },
      });
      const gepaMap = new Map<string, GepaCandidateEntry>();
      for (const c of candidates ?? []) {
        const key = `${c.promptKey}::${c.tenantId ?? 'null'}`;
        if (gepaMap.has(key)) continue;
        gepaMap.set(key, {
          promptKey: c.promptKey,
          tenantId: c.tenantId,
          promptText: c.promptText,
          abTrafficShare: c.abTrafficShare ?? 0.1,
        });
      }
      this.gepaCandidates = gepaMap;
    } catch (err) {
      this.logger.debug(
        `refreshCache: gepa candidates skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.debug(
      `refreshCache: загружено ${map.size} routes, ${this.gepaCandidates.size} gepa-candidates`,
    );
  }

  /**
   * Agents v2 Фаза C2 — деpolicyrministic-hash A/B routing.
   * Возвращает candidate если invocation попадает в первые
   * `abTrafficShare * 100` процентов hash-bucket'а. Иначе undefined.
   *
   * Hash-сид — комбинация `taskType + tenantId + currentMs` (последнее
   * меняется → распределение случайное во времени). Это даёт ~10% при
   * trafficShare=0.1, проверено в тесте через 1000 invocations.
   *
   * Используется в `call()` для замены systemPrompt + проставления
   * experimentGroup='gepa_candidate'.
   */
  private pickGepaCandidate(
    taskType: LlmTaskType,
    tenantId: string | null,
    sampleSeed?: string,
  ): GepaCandidateEntry | undefined {
    // Сначала per-tenant, потом global. Если оба — берём per-tenant.
    const perTenantKey = `${taskType}::${tenantId ?? 'null'}`;
    const globalKey = `${taskType}::null`;
    const candidate =
      this.gepaCandidates.get(perTenantKey) ??
      (tenantId !== null ? this.gepaCandidates.get(globalKey) : undefined);
    if (!candidate) return undefined;

    const seed = sampleSeed ?? `${Date.now()}-${Math.random()}`;
    const hash = simpleHash(`${taskType}::${tenantId ?? 'null'}::${seed}`);
    const bucket = hash % 100;
    const threshold = Math.round(candidate.abTrafficShare * 100);
    return bucket < threshold ? candidate : undefined;
  }

  async getRoutes(): Promise<LlmTaskRoute[]> {
    return [...this.allRoutes];
  }

  /**
   * Upsert route + немедленная инвалидация кэша. `providers` — массив имён
   * провайдеров в порядке fallback'а.
   */
  async setRoute(args: {
    taskType: LlmTaskType;
    providers: LlmProviderName[];
    isActive: boolean;
  }): Promise<LlmTaskRoute> {
    const valid = args.providers.filter((p) =>
      (ALL_PROVIDERS as string[]).includes(p),
    ) as LlmProviderName[];
    if (valid.length === 0) {
      throw new Error(`setRoute: пустой список валидных провайдеров для ${args.taskType}`);
    }
    const existing = await this.prisma.llmTaskRoute.findFirst({
      where: { taskType: args.taskType, tenantId: null },
    });
    const updated = existing
      ? await this.prisma.llmTaskRoute.update({
          where: { id: existing.id },
          data: {
            providers: valid as unknown as object,
            isActive: args.isActive,
          },
        })
      : await this.prisma.llmTaskRoute.create({
          data: {
            taskType: args.taskType,
            tenantId: null,
            providers: valid as unknown as object,
            isActive: args.isActive,
          },
        });
    await this.refreshCache();
    return updated;
  }

  /**
   * Главный метод. Пробует провайдеров последовательно, на любую ошибку —
   * следующий. На успех — записывает в AiUsageLog и возвращает результат.
   *
   * Фаза 11: если caller передал `params.dataClass` (или маршрут задаёт
   * `requiredDataClass`), результирующий класс данных = max двух. Затем
   * провайдеры фильтруются по `provider.maxDataClass >= effectiveClass`.
   * Если после фильтра пусто — `NoEligibleProviderError` + метрика
   * `core_data_class_violations_total` += 1.
   */
  async call(params: LlmCallParams): Promise<LlmCallResult> {
    const route = this.allRoutes.find(
      (r) => r.taskType === params.taskType && r.tenantId === null && r.isActive,
    );
    const effectiveDataClass = this.resolveEffectiveDataClass(route, params.dataClass);
    const { providers, experimentGroup: baseExperimentGroup } = this.chooseProviders(
      route,
      params,
    );

    // Agents v2 Фаза C2 — A/B GEPA candidate routing. Если активный candidate
    // для (taskType, tenantId) есть И invocation попал в trafficShare-bucket
    // (deterministic hash), заменяем systemPrompt и помечаем
    // experimentGroup='gepa_candidate'. Перекрывает baseExperimentGroup
    // (старый A/B по моделям через LlmTaskRoute.experiment) — GEPA важнее,
    // т.к. оптимизирует prompt, а не модель.
    const gepaCandidate = this.pickGepaCandidate(params.taskType, params.tenantId);
    let effectiveSystemPrompt = params.systemPrompt;
    let experimentGroup: 'A' | 'B' | 'gepa_candidate' | null = baseExperimentGroup;
    if (gepaCandidate) {
      effectiveSystemPrompt = gepaCandidate.promptText;
      experimentGroup = 'gepa_candidate';
    }
    // Используем effectiveParams для dispatch — это единственный путь, через
    // который провайдер увидит подменённый systemPrompt.
    const effectiveParams: LlmCallParams =
      effectiveSystemPrompt === params.systemPrompt
        ? params
        : { ...params, systemPrompt: effectiveSystemPrompt };

    // Фаза 11: фильтр по dataClass.
    const filtered = providers.filter((entry) => {
      const cap = PROVIDER_CAPABILITY[entry.provider];
      return DATA_CLASS_RANK[cap.maxDataClass] >= DATA_CLASS_RANK[effectiveDataClass];
    });

    if (filtered.length === 0) {
      this.metrics?.incCoreDataClassViolation({
        taskType: params.taskType,
        attemptedClass: effectiveDataClass,
      });
      this.logger.error(
        {
          taskType: params.taskType,
          dataClass: effectiveDataClass,
          attempted: providers.map((p) => p.provider),
        },
        'LlmRouter: no eligible provider for dataClass — block dispatch',
      );
      throw new NoEligibleProviderError(
        params.taskType,
        effectiveDataClass,
        providers.map((p) => p.provider),
      );
    }

    // Pre-dispatch budget gate (ТЗ cost-safety Ф2). Best-effort, observe по умолчанию.
    const bev = await this.budgetGuard?.evaluate(params.tenantId).catch(() => null);
    if (bev?.over) {
      const enforce =
        (await this.cfg?.getDynamic<boolean>('llm.budget.enforce_enabled', undefined, false)) ??
        false;
      this.metrics?.incLlmBudgetExceeded({ mode: enforce ? 'enforce' : 'observe' });
      if (enforce) {
        throw new LlmBudgetExceededError(params.tenantId, bev.mtdRub, bev.capRub);
      }
      this.logger.warn(
        { tenantId: params.tenantId, mtdRub: bev.mtdRub, capRub: bev.capRub },
        'LlmRouter: бюджет превышен, но enforce выключен — пропускаю (observe)',
      );
    }

    const errors: Array<{ provider: string; message: string }> = [];
    const overallStartedAt = Date.now();
    // Фаза A.4 — какой tier фактически использовался на предыдущей итерации.
    // Используется для построения fallbackReason у следующего вызова.
    let lastFailTier: LlmRouteTier | null = null;

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i] as ProviderEntry;
      const startedAt = Date.now();
      // Фаза A.4 — какой tier фактически использован. Если у entry задан tier
      // (нормализованная запись) — берём его. Иначе считаем по позиции в filtered
      // ('primary'/'secondary'/'tertiary' для индекса 0/1/2; позиции >2 → 'tertiary').
      const effectiveTier: LlmRouteTier =
        entry.tier ?? (i === 0 ? 'primary' : i === 1 ? 'secondary' : 'tertiary');
      // Причина срабатывания fallback'а: null для первого (primary) вызова,
      // иначе '<source-tier>_<кодError>'. Используется в аналитике admin'а.
      const fallbackReason: string | null = i === 0
        ? null
        : `${lastFailTier ?? 'primary'}_${classifyError(errors[errors.length - 1]?.message ?? 'error')}`;
      try {
        // audit С30 (2026-05-29): hard-timeout. Если провайдер «висит»
        // дольше 30 секунд — мы не должны блокировать весь fallback-цикл.
        // Без race зависший primary не давал шанса secondary даже отработать.
        // 30s — компромисс: дольше большинства LLM-ответов, но короче 60s
        // default'а Node fetch. Конфигурируется через ENV
        // LLM_ROUTER_DISPATCH_TIMEOUT_MS.
        // Per-call override (params.timeoutMs): caller'ы с долгим синтезом
        // (например chat-v2) могут поднять таймаут выше глобального, не трогая
        // остальные вызовы. Если не задан — поведение байт-в-байт прежнее.
        const effectiveTimeoutMs = params.timeoutMs ?? this.dispatchTimeoutMs;
        const out = await Promise.race([
          this.dispatch(entry, effectiveParams),
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `LLM dispatch timeout: ${entry.provider}/${entry.model} > ${effectiveTimeoutMs}ms`,
                  ),
                ),
              effectiveTimeoutMs,
            ),
          ),
        ]);
        // ТЗ-3 Ф2 (router-validate-callback): caller-валидатор вывода. HTTP 200
        // с битым телом (не JSON-вердикт) раньше считался успехом и secondary
        // не пробовался. Теперь — throw в существующий catch ниже → следующий
        // провайдер (secondary с настоящим strict). Проверка ДО записи success.
        if (params.validate && !params.validate(out.text)) {
          this.metrics?.incLlmRouterDispatch({
            taskType: params.taskType,
            provider: entry.provider,
            status: 'invalid_output',
          });
          throw new LlmInvalidOutputError(
            `${entry.provider}/${entry.model ?? ''}: ответ не прошёл validate caller'а`,
            out.text,
          );
        }
        const durationMs = Date.now() - startedAt;
        this.metrics?.incLlmRouterDispatch({
          taskType: params.taskType,
          provider: entry.provider,
          status: 'success',
        });
        const cachedTokens = out.cachedTokens ?? 0;
        const cacheCreationTokens = out.cacheCreationTokens ?? 0;
        const costUsd = await this.computeCostUsd(
          out.provider,
          out.model,
          out.inputTokens,
          out.outputTokens,
          cachedTokens,
        );
        const invocationId = await this.usage.record({
          tenantId: params.tenantId,
          meetingId: params.meetingId ?? null,
          userId: params.userId ?? null,
          taskType: params.taskType,
          agentType: this.taskTypeToAgentType(params.taskType),
          jobId: params.jobId ?? null,
          model: out.model,
          provider: out.provider,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          cachedTokens,
          cacheCreationTokens,
          costUsd,
          durationMs,
          success: true,
          sourceRef: params.sourceRef ?? null,
          experimentGroup,
          tier: effectiveTier,
          fallbackReason,
          // Z-Admin Фаза 7: превью промпта (system+user) и ответа для drill-down.
          // Truncate до 8KB на стороне AiUsageLogService.
          requestPreview: this.buildRequestPreview(
            effectiveSystemPrompt,
            params.userMessage,
          ),
          responsePreview: out.text,
        });

        // Agents v2 Фаза B1 — эмит для PromptFeedbackCollectorService.
        // Эмитим ТОЛЬКО при наличии tenantId (per-Org вызовы) и invocationId
        // (запись AiUsageLog прошла). Системные вызовы без tenant'а не
        // попадают в feedback (это валидно: правила всё равно per-Org/global).
        if (invocationId && params.tenantId && this.events) {
          this.events.emit('ai.invocation.completed', {
            invocationId,
            tenantId: params.tenantId,
            promptKey: params.taskType,
            // Версия промпта пока неизвестна на уровне LlmRouter (промпты — в
            // call-site'ах). Используем модель как proxy для версионирования;
            // когда появится PromptRegistry — заменим на реальную версию.
            promptVersion: `${out.provider}:${out.model}`,
            input: {
              systemPrompt: effectiveSystemPrompt,
              userMessage: params.userMessage,
            },
            output: out.text,
          });
        }
        this.logger.log(
          {
            taskType: params.taskType,
            provider: entry.provider,
            model: out.model,
            durationMs,
            inputTokens: out.inputTokens,
            outputTokens: out.outputTokens,
            cachedTokens,
            experimentGroup,
            tier: effectiveTier,
            fallbackReason,
            meetingId: params.meetingId,
          },
          'LlmRouter dispatch success',
        );
        return {
          text: out.text,
          modelUsed: `${out.provider}:${out.model}`,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          cachedTokens,
          durationMs: Date.now() - overallStartedAt,
          tier: effectiveTier,
          providerUsed: out.provider,
          ...(out.toolCalls && out.toolCalls.length > 0
            ? { toolCalls: out.toolCalls }
            : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ provider: entry.provider, message });
        lastFailTier = effectiveTier;
        const isLast = i === filtered.length - 1;
        this.metrics?.incLlmRouterDispatch({
          taskType: params.taskType,
          provider: entry.provider,
          status: isLast ? 'failed' : 'fallback',
        });
        const isValidateFailure = err instanceof LlmInvalidOutputError;
        const logLevel = isLast || !isValidateFailure ? 'warn' : 'debug';
        this.logger[logLevel](
          {
            taskType: params.taskType,
            provider: entry.provider,
            durationMs: Date.now() - startedAt,
            isLast,
            tier: effectiveTier,
          },
          `LlmRouter dispatch ${isLast ? 'failed' : 'fallback'}: ${message}`,
        );
        // На последнем провайдере — записываем неуспешный AiUsageLog.
        if (isLast) {
          await this.usage.record({
            tenantId: params.tenantId,
            meetingId: params.meetingId ?? null,
            userId: params.userId ?? null,
            taskType: params.taskType,
            agentType: this.taskTypeToAgentType(params.taskType),
            jobId: params.jobId ?? null,
            model: entry.model ?? params.model ?? 'unknown',
            provider: this.providerNameToUsageProvider(entry.provider),
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            durationMs: Date.now() - startedAt,
            success: false,
            errorText: message,
            sourceRef: params.sourceRef ?? null,
            experimentGroup,
            tier: effectiveTier,
            fallbackReason,
            requestPreview: this.buildRequestPreview(
              effectiveSystemPrompt,
              params.userMessage,
            ),
            responsePreview: null,
          });
        }
      }
    }

    // Фаза A.4 — все tier'ы упали → инкрементируем метрику отсутствия
    // подходящего провайдера. Это сигнал для on-call: ни primary, ни secondary,
    // ни tertiary не отвечают на конкретный taskType. Optional-chaining не только
    // на сервисе, но и на методе — на случай мока с неполным интерфейсом.
    this.metrics?.incCoreLlmNoProvider?.({ taskType: params.taskType });
    throw new LlmRouterAllProvidersFailedError(params.taskType, errors);
  }

  /**
   * Удобный helper: достать tenantId по meetingId. Если meeting не найден или
   * у него tenantId=null — вернёт null. Используется в воркерах AI, где
   * caller знает только meetingId.
   */
  async resolveTenantByMeeting(meetingId: string): Promise<string | null> {
    const m = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { tenantId: true },
    });
    return m?.tenantId ?? null;
  }

  /**
   * Helper: достать tenantId по userId (берём первый Membership).
   * Подходит для вызовов, не привязанных к встрече (chat cross-meeting и т.п.).
   */
  async resolveTenantByUser(userId: string): Promise<string | null> {
    const m = await this.prisma.membership.findFirst({
      where: { userId, org: { deletedAt: null } },
      select: { orgId: true },
      orderBy: { joinedAt: 'asc' },
    });
    return m?.orgId ?? null;
  }

  // ─────────────────────────── private ─────────────────────────────────────

  /**
   * Фаза 11: вычисление эффективного dataClass'а вызова.
   *
   *   max(params.dataClass ?? 'internal', route.requiredDataClass ?? 'internal').
   *
   * Берём «строжайший» из двух: caller знает класс входных данных, маршрут
   * может задавать минимальную чувствительность задачи (например, audit-flow
   * всегда 'sensitive').
   */
  private resolveEffectiveDataClass(
    route: LlmTaskRoute | undefined,
    callerClass: DataClass | undefined,
  ): DataClass {
    const fromCaller: DataClass = callerClass ?? 'internal';
    const fromRoute: DataClass = route?.requiredDataClass ?? 'internal';
    return DATA_CLASS_RANK[fromCaller] >= DATA_CLASS_RANK[fromRoute]
      ? fromCaller
      : fromRoute;
  }

  /**
   * Решает, какую цепочку провайдеров использовать с учётом A/B-эксперимента.
   * Возвращает providers и (опционально) метку группы для AiUsageLog.
   */
  private chooseProviders(
    route: LlmTaskRoute | undefined,
    params: LlmCallParams,
  ): { providers: ProviderEntry[]; experimentGroup: 'A' | 'B' | null } {
    if (route?.experiment) {
      const exp = route.experiment as ExperimentConfig;
      const now = Date.now();
      const startedAt = exp.startedAt ? Date.parse(exp.startedAt) : Number.NaN;
      const endsAt = exp.endsAt ? Date.parse(exp.endsAt) : Number.NaN;
      const inWindow =
        Number.isFinite(startedAt) &&
        Number.isFinite(endsAt) &&
        now >= startedAt &&
        now < endsAt;
      if (exp.enabled === true && inWindow && exp.modelA && exp.modelB) {
        const splitPercent = typeof exp.splitPercent === 'number' ? exp.splitPercent : 50;
        const pickA = Math.random() * 100 < splitPercent;
        const pick = pickA ? exp.modelA : exp.modelB;
        const entry = parseProviderModelString(pick);
        if (entry) {
          this.logger.debug(
            `experiment ${params.taskType}: group=${pickA ? 'A' : 'B'} → ${pick}`,
          );
          return { providers: [entry], experimentGroup: pickA ? 'A' : 'B' };
        }
      }
    }
    const cached = this.routes.get(params.taskType);
    if (cached && cached.length > 0) {
      return { providers: cached, experimentGroup: null };
    }
    return { providers: DEFAULT_FALLBACK_CHAIN, experimentGroup: null };
  }

  private async dispatch(
    entry: ProviderEntry,
    params: LlmCallParams,
  ): Promise<LlmCompleteOutput> {
    // Приоритет: явный override через params.model, иначе модель из route entry.
    const effectiveModel = params.model ?? entry.model;
    const input: LlmCompleteInput = {
      system: { text: params.systemPrompt, cacheControl: 'ephemeral' },
      user: params.userMessage,
      ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
      ...(effectiveModel !== undefined ? { model: effectiveModel } : {}),
      ...(params.responseFormat !== undefined
        ? { responseFormat: params.responseFormat }
        : {}),
      ...(params.reasoningEffort !== undefined
        ? { reasoningEffort: params.reasoningEffort }
        : {}),
      // ТЗ 2026-05-25: function-calling. Если воркер передал tools — пробрасываем
      // напрямую в провайдера. DeepSeek/OpenAI добавят `tool_choice='auto'`
      // автоматически (см. DeepSeekService.buildParams / OpenAiProxyService).
      ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {}),
    };
    // SBA α-10 wave 3 — Feature-flag USE_PROTOCOL_ADAPTER_REGISTRY.
    // false (default, production safety) → legacy switch ниже.
    // true → LlmProtocolAdapterRegistry резолвит protocolKind из LlmProvider/ENV.
    const useRegistry =
      this.cfg?.budget?.useProtocolAdapterRegistry === true &&
      this.adapterRegistry !== undefined &&
      this.providerInfo !== undefined;
    if (useRegistry) {
      const resolved = await this.providerInfo!.resolveByName(entry.provider);
      if (resolved) {
        const adapter = this.adapterRegistry!.resolve(resolved.protocolKind);
        return adapter.complete({ provider: resolved.info, input });
      }
      this.logger.warn(
        `LlmRouter: ProviderInfoResolver не нашёл провайдера ${entry.provider}; fallback на legacy switch`,
      );
    }
    switch (entry.provider) {
      case 'anthropic':
        return this.anthropic.complete(input);
      case 'minimax':
        return this.minimax.complete(input);
      case 'openai-via-proxy':
        return this.openai.complete(input);
      case 'deepseek':
        return this.deepseek.complete(input);
      case 'ollama':
        return this.ollama.complete(input);
      case 'kie':
        return this.kie.complete(input);
      case 'grsai':
        return this.grsai.complete(input);
      default: {
        const _exhaustive: never = entry.provider;
        throw new Error(`LlmRouter: неизвестный провайдер ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Стоимость вызова в USD. Сначала смотрим в `LlmModelPrice` (БД, актуальная
   * запись по effectiveFrom/effectiveTo). Если нет — fallback на код.
   * Кэшируем результат на 60 секунд, чтобы не бить БД на каждый LLM-вызов.
   */
  private async computeCostUsd(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
  ): Promise<number> {
    const key = `${provider}:${model}`;
    const cached = this.priceCache.get(key);
    const now = Date.now();
    let entry: PriceCacheEntry | null = null;
    if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
      entry = cached;
    } else {
      try {
        const fromDb = await this.prisma.llmModelPrice.findFirst({
          where: {
            provider,
            model,
            effectiveFrom: { lte: new Date(now) },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gt: new Date(now) } },
            ],
          },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (fromDb) {
          entry = {
            inputPer1M: Number(fromDb.inputCostPerMillionTokens),
            outputPer1M: Number(fromDb.outputCostPerMillionTokens),
            cachedPer1M: Number(fromDb.cachedCostPerMillionTokens),
            fetchedAt: now,
          };
          this.priceCache.set(key, entry);
        }
      } catch (err) {
        this.logger.warn(
          `computeCostUsd: db lookup failed (${key}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (entry) {
      const fullInputTokens = Math.max(0, inputTokens - cachedTokens);
      const cost =
        (fullInputTokens / 1_000_000) * entry.inputPer1M +
        (cachedTokens / 1_000_000) * entry.cachedPer1M +
        (outputTokens / 1_000_000) * entry.outputPer1M;
      return Math.round(cost * 1_000_000) / 1_000_000;
    }

    // Fallback на статическую карту в коде.
    if (!(model in MODEL_PRICES)) {
      this.logger.warn(
        `computeCostUsd: цена для ${key} не найдена ни в БД, ни в коде → costUsd=0 (заполни в админке)`,
      );
      this.metrics?.incLlmCostUnpriced({ provider, model });
    }
    return calcCostUsd(model, inputTokens, outputTokens, cachedTokens);
  }

  /**
   * Маппинг `taskType` → `agentType` для AiUsageLog. Существующая
   * `AiAgentType` enum в `AiUsageLogService` — сохраняем совместимость.
   */
  private taskTypeToAgentType(
    taskType: LlmTaskType,
  ): 'summary' | 'report-by-type' | 'follow-up' | 'tasks' | 'custom' {
    switch (taskType) {
      case 'summary':
        return 'summary';
      case 'tasks':
        return 'tasks';
      case 'follow-up':
        return 'follow-up';
      default:
        return 'custom';
    }
  }

  private providerNameToUsageProvider(
    p: LlmProviderName,
  ):
    | 'anthropic'
    | 'minimax'
    | 'openai-via-proxy'
    | 'deepseek'
    | 'ollama'
    | 'kie'
    | 'grsai' {
    return p;
  }

  /**
   * Превью промпта для AiUsageLog (Z-Admin Фаза 7).
   * Конкатенация system + user с метками. Truncate до 8KB делает AiUsageLogService.
   */
  private buildRequestPreview(systemPrompt: string, userMessage: string): string {
    return `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userMessage}`;
  }

  /**
   * Сбросить in-memory кэш цен. Вызывается из AdminPricesService при
   * изменении прайс-карты — следующий вызов прочитает свежие цены из БД.
   */
  refreshPrices(): void {
    this.priceCache.clear();
  }
}

/**
 * `LlmTaskRoute.providers` — Json. Поддерживаемые формы:
 *   - `string[]` — `['deepseek', 'openai-via-proxy']`.
 *   - `Array<{provider: string, model?: string}>` — c указанием модели.
 *   - `{providers: <одна из форм выше>}` — обёртка.
 *
 * Парсим в строгий список валидных provider+model.
 */
function parseProviders(raw: unknown): ProviderEntry[] {
  if (!raw) return [];
  let arr: unknown;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as { providers?: unknown }).providers)
  ) {
    arr = (raw as { providers: unknown[] }).providers;
  } else {
    return [];
  }
  const result: ProviderEntry[] = [];
  for (const item of arr as unknown[]) {
    if (typeof item === 'string') {
      if ((ALL_PROVIDERS as string[]).includes(item)) {
        result.push({ provider: item as LlmProviderName });
      }
      continue;
    }
    if (typeof item === 'object' && item !== null) {
      const providerRaw = (item as { provider?: unknown }).provider;
      const modelRaw = (item as { model?: unknown }).model;
      if (typeof providerRaw === 'string' && (ALL_PROVIDERS as string[]).includes(providerRaw)) {
        result.push({
          provider: providerRaw as LlmProviderName,
          ...(typeof modelRaw === 'string' && modelRaw.length > 0
            ? { model: modelRaw }
            : {}),
        });
      }
    }
  }
  return result;
}

/**
 * Парсит строку формата `<provider>:<model>` (используется в
 * `LlmTaskRoute.experiment.modelA/modelB`).
 */
function parseProviderModelString(s: string): ProviderEntry | null {
  const idx = s.indexOf(':');
  if (idx <= 0 || idx === s.length - 1) return null;
  const provider = s.slice(0, idx);
  const model = s.slice(idx + 1);
  if (!(ALL_PROVIDERS as string[]).includes(provider)) return null;
  return { provider: provider as LlmProviderName, model };
}

/**
 * Фаза A.4 — классификация ошибки провайдера для `fallbackReason`. Из исходного
 * текста ошибки извлекаем короткий код: timeout / rate_limit / auth / network / error.
 * Используется в аналитике `/admin/ai-models` для понимания, почему случается fallback.
 */
function classifyError(message: string): string {
  const m = message.toLowerCase();
  if (/(timeout|timed out|etimedout|deadline)/.test(m)) return 'timeout';
  if (/(429|rate.?limit|too many requests|quota)/.test(m)) return 'rate_limit';
  if (/(401|403|unauthorized|forbidden|invalid.*key|api[_ ]?key)/.test(m)) return 'auth';
  if (/(econn|enotfound|eai_again|socket hang up|fetch failed|network)/.test(m)) return 'network';
  if (/5\d\d/.test(m)) return 'server_5xx';
  return 'error';
}

/**
 * Agents v2 Фаза C2 — стабильный 32-бит fnv1a-hash для deterministic A/B
 * sampling. Тот же алгоритм, что в `dialog-layer/utils/tenant-top.ts`.
 * Используется в `LlmRouterService.pickGepaCandidate` для распределения
 * 10% трафика на тестируемый PromptCandidate.
 */
function simpleHash(s: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x0100_0193);
    h >>>= 0;
  }
  return h >>> 0;
}
