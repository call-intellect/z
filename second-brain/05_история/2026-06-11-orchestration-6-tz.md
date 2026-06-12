---
date: 2026-06-11
type: reflection
distilled: false
feature: финиш «сейчас» — 6 ТЗ (ASR-сегменты · промпты-MASTER · кабинет-honesty · ChatBox память+задачи · Мобильная Кора · probe-fix)
branch: feature/finishable-now-2026-06-11
---

# Рефлексия — оркестрация 6 ТЗ одной волной (finishable-now)

## Что было поставлено

Большая сессия-«финиш доводимого сейчас»: реализовать шесть независимых ТЗ из дорожной карты
`plans/analysis/2026-06-11-finishable-now-roadmap.md`, не блокируясь на том, что требует прод-доступа/
владельца. Список:

1. **ASR — посегментные тайминги Vox** ([`2026-06-11-asr-segment-timings-persist-and-merge.md`](../../plans/tz/2026-06-11-asr-segment-timings-persist-and-merge.md)) — персист `extendedResult.segments` + мердж по времени.
2. **Промпты-MASTER** ([`prompt-polish-fewshot-org-and-reports`](../../plans/tz/2026-06-11-prompt-polish-fewshot-org-and-reports.md) + [`org-extractor-and-compiler-finalize`](../../plans/tz/2026-06-11-org-extractor-and-compiler-finalize.md)) — A: орг-агенты regulation/policy/instruction + строгий гейт `isOrgNorm` + версии + sync шагов; B: 11 few-shot примеров.
3. **Кабинет — honesty, 2 волны** ([`cabinet-inbox-nav-ui-honesty`](../../plans/tz/2026-06-11-cabinet-inbox-nav-ui-honesty.md)) — Волна 1 (ребренд «Кора-Админ» + маппер имён, автоген slug, документы-контракт, архив спринтов, пикер + ControlsBar), Волна 2 (primary-nav + `/feed` + сворачивание Sidebar + welcome-тур).
4. **ChatBox — память + задачи** ([`chatbox-memory-finishing-and-tasks-from-chat`](../../plans/tz/2026-06-11-chatbox-memory-finishing-and-tasks-from-chat.md)) — Ф1 матчинг участников + клиент, Ф5 задачи из переписки, Ф6 межисточниковый дедуп.
5. **Мобильная Кора** — Ф0 каркас + Ф1 первый экран.
6. **probe.question context-leak fix** ([`probe-question-context-leak-fix`](../../plans/tz/2026-06-11-probe-question-context-leak-fix.md)) — `payload.message` больше не течёт сырым в уведомление-вопрос.

## Как решал

- **Оркестрация суб-агентами по фазам** (tz-orchestrator): на каждое ТЗ — картография кода → точные
  промпты кодерам → независимая приёмка (греп ключевых маркеров + re-Read после Edit + свой
  typecheck/lint/build/тесты), коммит по фазам. Многоволновая модель без остановок: зелёная
  верификация фазы → commit → следующая фаза в том же ответе.
- **Workflow-фан-аут для 11 few-shot** (промпты-MASTER B): примеры разнесены по агентам параллельно,
  но строго **под фактическую схему файла-промпта** (не под «идеальную» из ТЗ) — иначе snapshot-тесты
  и сборка промпта падают.
- **Миграции:** две новые — `20260611100000_transcript_track_segments` (`TranscriptTrack.segments Json?`)
  и `20260611110000_chatbox_tasks_and_customer_link` (`Task.meetingId → nullable` + `sourceType`/
  `sourceChatSessionId`/`sourceChatId` + `TaskSource` + `ChatboxCustomer`/`ChannelClient.linkedPersonId`/
  `linkMode`). Backfill `backfill-task-source-type.ts` (safety no-op, в `apply-prod-deploy STEPS`).
- **Флаги (все kill-switch, default ON, Ship-On):** `REGULATION_GATE_STRICT_ENABLED`,
  `CHATBOX_TASK_EXTRACTION_ENABLED`, `TASKS_CROSS_SOURCE_DEDUPE_ENABLED`. Push Мобильной Коры — на
  VAPID-ENV (не флаг; нет ключей → отправка no-op).
- **Верификация:** typecheck + lint + build + точечные тесты по фазам; финальный lint-свип отдельным
  коммитом.

## Что вышло

- **13 коммитов** на ветке `feature/finishable-now-2026-06-11`, всё зелёное (typecheck/lint/build,
  тесты затронутых фаз). Коммиты (новейшие сверху): Мобильная Кора Ф0+Ф1; ChatBox Ф1 (матчинг+клиент);
  ChatBox Ф5+Ф6 (задачи из переписки + дедуп); probe.question context-leak fix; ChatBox миграция
  (Task nullable + source/TaskSource/chatbox linkedPersonId); Кабинет Волна 2; Кабинет Волна 1 фронт;
  Кабинет Волна 1 backend; Кабинет Волна 1 (ребренд + маппер имён); промпты-MASTER B (11 few-shot);
  промпты-MASTER A (орг-агенты + гейт `isOrgNorm` + версии + sync шагов); ASR посегментные тайминги;
  lint-фиксы.
- Доки обновлены: `docs/operations/feature-flags.md` (3 kill-switch + 2 AdminSetting + VAPID-блок),
  `docs/operations/prod-deploy-log.md` (новый блок «Накоплено к выкату»: 2 миграции, 3 ENV + VAPID,
  backfill, прод-патч ChatBox Ф0), `second-brain/02_architecture/data-model.md` (segments, Task-source,
  TaskSource, chatbox link), `code-pitfalls.md` (Vox-сегменты, дрейф ApiDto↔DTO как класс),
  `04_не-сделано/README.md` (открытые остатки).

## Что осталось

- **ChatBox:** Ф0 (прод-патч включения анализа у «Ооо луа» и др.), Ф2 (виджет «Чаты в памяти»),
  Ф3 (метрики + алерт), Ф4 (разбор WARN `sendMessage` — нужна живая отправка).
- **Мобильная Кора Ф2–Ф8:** Обзор, разделы, чек-ин, «Спросить», Память, push-крон (нужны VAPID-ключи
  в проде), свайп-жесты.
- **Кабинет Ф8–Ф10 docs** (доводка документации разделов).
- **Промпты-MASTER A4:** few-shot для insight-экстрактора — ждёт «да» владельца.
- **ASR:** word-level тайминги Tier1 (запрос к `agent-lia`) + backfill старых встреч.

## Чему научился

- **Каскад `meetingId`-nullable на view-типы.** Сделать `Task.meetingId` nullable — это не одна
  колонка: все читатели «задач встречи» (`where:{meetingId}`) и UI-мапперы должны допускать `null`.
  Нужно пройти весь класс потребителей, иначе тихие пропуски/падения там, где раньше `meetingId`
  гарантированно был.
- **Few-shot строго под фактическую схему файла промпта**, а не под «как в ТЗ». Пример, не
  соответствующий реальной форме system/user или JSON-schema, ломает snapshot-тест и сборку промпта.
  Сначала читаем фактический промпт-билдер, потом пишем пример.
- **Кодмод импортов ломает многострочные `import`-блоки.** Авто-правка импортов (lint-fix/кодмод)
  на многострочных `import { ... } from '...'` может побить блок — после массовой правки импортов
  обязателен re-Read + локальный typecheck, нельзя доверять «зелёному» от самого кодмода.
- **Дрейф ApiDto↔серверный DTO — это класс** (persons list/byId, documents). Лечится обратным
  read-маппером в api-слое; один найденный дрейф → ищи остальные list/byId-эндпоинты.
