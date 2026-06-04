---
date: 2026-06-04
feature: knowledge-card-correct (Action Center / лестница доверия, суб-ТЗ E)
branch: feature/action-center-trust-ladder
commits:
  - b3e6f311 (E1 backend)
  - b3b76352 (E2 frontend)
  - 88367cc6 (docs/статусы)
distilled: false
---

# Рефлексия — «Поправить карточку знаний» (E1 backend + E2 frontend)

## Что было поставлено
Доделать суб-ТЗ E `2026-06-03-knowledge-card-correct.md` в worktree `feature/action-center-trust-ladder`:
два действия на провизорной карточке (regulation/process/policy/decision) — **«Исправить»**
(правка текста: owner/admin применяют сразу до `trustTier='human'`; рядовой → предложение в курацию)
и **«Это неверно»** (флаг-оспаривание). Оркестрация скиллом tz-orchestrator.

## Как решал
- **Картография (сам, без vexp — он не подключён в сессии):** прочитал curation.service (`recordDecision`,
  приватный `appendCardVersion`, `decide`), decisions.service (`writeCardVersion` — append + `currentVersionId`),
  regulations.service, specialist-3-1-regulations (канонизация regulation/process/policy), модели Prisma,
  DTO, `PreferenceDatasetService` (маппинг decisionType→label).
- **E1 (general-purpose кодер, коммит b3e6f311):** `CurationService.submitProposal` (pending CurationItem,
  `triageReason.via='user_correction'`); `dispute`/`correct` в decisions.service и regulations.service
  (+приватный `writeRegulationCardVersion` по образцу decisions); контроллеры — RBAC `requireRead` +
  `canWrite`-ветка `canApplyDirectly`; `RegulationsModule` += `CurationModule`. 69 backend-тестов.
- **E2 (general-purpose кодер):** переиспользуемый `CardCorrectionActions` (`src/ui/components/knowledge/`)
  с чистыми хелперами (подпись по правам, success-текст по `applied`, `pickChangedFields`); api
  dispute/correct; вшивка в RegulationsListClient/DecisionsListClient. 172 фронт-теста.
- **Приёмка — сам, не по отчёту агента:** греп маркеров, re-Read ключевой логики, прогон
  typecheck/lint/build/тесты в обоих проектах. Спеки фактчекнул — реально проверяют поведение.

## Что вышло
- Backend: typecheck/lint(0 err)/build зелёные, тесты 69. Frontend: typecheck/lint/build/test:unit(172).
- Доминирующий путь Z (owner/admin правят сразу) закрыт полностью; обучающие сигналы пишутся
  (correct→label `correct`, dispute→`misleading`).
- Вскрытый пробел вынесен в суб-ТЗ `2026-06-04-curation-canonical-writeback.md` (не оставил идеей в отчёте).

## Чему научился (граблики и факты проекта)
1. **Курация НЕ пишет канонический контент при `decide()`.** Для regulation/decision/process/policy
   контент таблицы пишет **специалист 3.1/3.3 ДО triage**, а `decide(approve*)` лишь создаёт `CardVersion`
   (`appendCardVersion`, trustTier) — таблицу и `currentVersionId` он НЕ трогает. Нет ни одного
   `@OnEvent('curation.decision_recorded')`, применяющего одобренный `proposedPayload` к канону
   (consumer только `PreferenceDatasetService` — обучающие сэмплы). Поэтому «применить правку сразу»
   обязано жить в сервисе самой карточки (update таблицы + append CardVersion + currentVersionId).
   → кандидат в `02_architecture/code-pitfalls.md`.
2. **`recordDecision` создаёт DECIDED item, не pending.** Для «предложения на проверку» нужен отдельный
   путь (`submitProposal` → `status='pending'`). Не перепутать: dispute = recordDecision (сигнал-флаг,
   как `entities/:id/mark-wrong`); propose-правка = submitProposal (очередь куратору).
3. **`CurationModule` НЕ глобальный** (несмотря на устаревший комментарий «CurationModule в @Global»
   в entities.controller). Чтобы инжектить `CurationService` в чужой сервис — модуль должен явно
   импортировать `CurationModule` (как DecisionsModule; RegulationsModule пришлось дополнить).
4. **`PreferenceDatasetService.decisionTypeToLabel`:** `approve|approve_with_edits`→`correct`,
   `rejected`→`wrong`, `mark_as_misleading`→`misleading`. Это и обосновало выбор decisionType
   для обучающего сигнала (доказано кодом, не угадано).
5. **Frontend `test:unit` = `vitest run --dir src`** — специи под `app/` НЕ прогоняются. Переиспользуемые
   компоненты + спеки клал под `src/ui/...`, клиенты делал тонкими.
6. **Минор (как и в существующем `decisions.writeCardVersion`):** apply-правка не в одной транзакции —
   при сбое БД между `update` и `CardVersion` бейдж может не сняться. Совпадает с текущим паттерном кода;
   полную атомарность не вводил (минимальные безопасные изменения).
7. **Worktree-дисциплина:** работал строго в `C:\work\z-action-center` (ветка feature), `C:\work\z` на dev
   не трогал. Кодерам-агентам — абсолютные пути + `cd /c/work/z-action-center/...` в каждой bash-команде.
