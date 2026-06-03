---
type: tz
status: ready-to-implement
date: 2026-06-03
owner: sergrv80@gmail.com
branch: feature/action-center-trust-ladder
relates_to:
  - plans/tz/2026-06-02-action-center-pending-confirmations.md
  - second-brain/02_architecture/knowledge-core.md
  - second-brain/01_projects/admin.md
phases:
  - C1
  - C2
  - C3
---

> **Статус:** ТЗ готово к реализации. Это **остаток** по ТЗ `2026-06-02-action-center-pending-confirmations.md` (Часть A «Лестница доверия» + Часть B «Action Center») — три пункта, которые не вошли в основную реализацию. Базовые фазы A0–A2 и B0–B5 **уже сделаны и лежат в ветке `feature/action-center-trust-ladder`** (запушена в origin). Стартовать с **Фазы C1**.

# Action Center — остаток (метка доверия, крутилки, detail-страницы)

## 0. Где это и что уже готово (читать первым)

Вся работа — в ветке **`feature/action-center-trust-ladder`** (от `dev`, запушена в origin). Продолжать **в этой же ветке** (рекомендуется отдельный git worktree, чтобы не мешать параллельным сессиям — см. промпт оркестратора).

**Уже реализовано (НЕ переделывать) — Часть A «Лестница доверия» + Часть B «Action Center»:**
- **Курация (`backend/src/modules/curation`)**: триаж сравнивает калиброванную уверенность с **пер-типовыми порогами** (`autoThresholdByType`/`deepReviewThresholdByType` в `Org.curationSettings`). Критические типы (`regulation`/`process`/`decision`) проходят **AI-судью** (`MultiAgentDebateService.judge({taskFamily:'curation-verify'})`, 3 голоса) → при accept-консенсусе **провизорная канонизация** с `CardVersion.trustTier='provisional'`; reject/split/недоступен → `CurationItem(level=deep)` к человеку. Аудит-выборка 5%. `CurationAutotuneCron` (kill-switch всегда + автоподстройка порогов opt-in). `getOverrideStats`/`getProvisionalAuditStats`. Endpoint `GET /api/v1/curation/override-stats`.
- **Trust tier**: enum `TrustTier { auto provisional human }`, поле `CardVersion.trustTier @default(human)` (schema). На auto-канонизации → `auto`, AI-провизорно → `provisional`, человеческое решение → `human`.
- **Агрегатор (`backend/src/modules/pending-actions`)**: `PendingActionsService` + 4 провайдера (curation/conflict/intake/probe) + модель `PendingActionSnooze`. REST `GET /pending-actions/count`, `GET /pending-actions`, `POST /pending-actions/snooze`, `POST /pending-actions/confirm` (one-tap approve для light curation). Кроны `PendingActionsReminderCron` (Telegram-напоминания) и `CurationItemLifecycleCron` (pending→expired по `expiresAt`).
- **Frontend**: пункт сайдбара «Подтверждения» (бейдж, `usePendingActionsCount`), глобальный колокольчик `PendingActionsBell` (AppShell + Header), страница `/actions` (`app/(authenticated)/actions/`), блок `requiresAction` на дашборде (`RequiresActionTile`/`RequiresActionBanner`). Слои `src/api/pending-actions.api.ts`, `src/domain/pending-action.ts`.

**Закрытые развилки (НЕ переоткрывать без согласования владельца):**
- Telegram-бот **намеренно zero-button** (β-1 rip-out): inline-кнопки/`callback_query` удалены. Быстрое подтверждение делаем **в приложении**, не в чате. НЕ возвращать inline-кнопки в Telegram.
- `MultiAgentDebateService` обобщён `taskFamily` (default `decision-supersede`). Семейство `curation-verify` использовать как есть.
- Лестница доверия (калибровка + AI-судья + провизорный уровень + обратимость) — окончательная архитектура; «просто понизить порог» отвергнуто.

**ВАЖНО про БД:** изменения схемы из Части A/B (`CardVersion.trustTier`, `PendingActionSnooze`) ещё **не применены `prisma db push` к общему dev-Postgres** (он держит схему параллельной ветки goals-okr-v2). Для разработки C-фаз достаточно `bun run prisma:generate` (офлайн). Реальный `db push` — на выкате/мерже, не из изолированного worktree.

---

## Что осталось — 3 пункта

## Фаза C1 — Видимая метка «не подтверждено человеком» (приоритет 1)

**Проблема (человеческим языком):** AI теперь сам канонизирует критические карточки (решения/правила/процессы) как **провизорные** (`trustTier='provisional'`). В данных это записано, но в UI Карты знаний и в цитатах корпоративного чата провизорные карточки **визуально не отличаются** от подтверждённых человеком. Пользователь не понимает, на что можно опираться как на проверенное, а что — AI-черновик. Это незакрытый acceptance Фазы A1 («Метка доверия видна в UI/чате»).

**Что входит:**
- **Backend**: убедиться, что `trustTier` (из `CardVersion`, актуальная версия — `currentVersionId`) **выезжает в read-DTO** карточек, которые показываются пользователю: реестры `regulations` / `decisions` / `processes` (модели `Regulation`/`Decision`/`Process` с `currentVersionId → CardVersion`), детальные карточки, и **цитаты chat-v2** (где ответ ссылается на карточку). Найди соответствующие read-сервисы/контроллеры и пробрось поле `trustTier` (или булево `humanVerified = trustTier==='human'`).
- **Frontend**: компонент-плашка `TrustBadge` (по `trustTier`): `provisional` → «⚠️ Подтверждено ИИ, не проверено человеком» (нейтрально-предупреждающий тон, **парные токены** — `chip-warning`/`chip-warning-fg`); `auto` → опц. лёгкая пометка «Авто» (или ничего); `human` → ничего (это норма). Показать плашку:
  1. в списках/карточках Памяти компании (`/regulations`, `/decisions`, `/insights`/`/processes` — те, что реально рендерят карточки критических типов);
  2. рядом с цитатой в ответе корпоративного чата (chat-v2 citations), если цитата ссылается на провизорную карточку.
- Кнопка «Это неверно» уже существует (`CurationService.recordDecision`) — провизорные карточки обратимы; убедиться, что она доступна рядом с провизорными (если уже есть в UI карты — ничего не добавлять).

**Что НЕ входит:** изменение логики канонизации (она в A1); новые эндпоинты решений (только проброс поля).

**Acceptance:**
- [x] `trustTier` присутствует в read-DTO карточек регуляций/решений/процессов (regulations.service — regulation/process/policy; decisions.service — list/detail/supersede-chain; provenance документа). ⚠️ Цитаты chat-v2 — **карточек как цитат не существует** (цитаты только на встречи, `CardSpecialistRegistry` не подключён) → вынесено в суб-ТЗ **D** `2026-06-03-chat-v2-card-citations.md`.
- [x] Провизорная карточка в Карте знаний показывает плашку «Не проверено человеком» (`TrustBadge`); человеческая — без плашки. Покрыты: `/regulations` (+ process/policy), `/decisions` (список+деталь), вкладка «Извлечённые сущности» документа.
- [ ] Цитата в чате на провизорную карточку помечена — **невозможно сейчас** (нет цитат-карточек) → суб-ТЗ **D**.
- [x] Цвета — парные токены (`Chip` warning/sand), без `text-white`/hex. typecheck/lint/тесты (back+front) зелёные. Unit на маппер плашки (`trustBadgeConfig`: provisional→warning, human→null, auto→sand) + backend-спеки проброса + тест трансформации `buildEntityGroups`.

**Статус C1 (2026-06-03): закрыта по Карте знаний.** Доделано сверх дословного scope (правило «чини класс»): (1) **documents provenance** — те же критические карточки в `GET /documents/:id` показывались без метки; пробросил trustTier + починил pre-existing контрактный баг фронта (`entityGroups` vs `extractedEntities` — вкладка крашилась) трансформацией в api-слое; (2) **supersede-chain** decisions — предки/потомки тоже размечены. Два пробела вынесены в суб-ТЗ (ждут go владельца): **D** — цитаты-карточки chat-v2 (продукт+стоимость); **E** `2026-06-03-knowledge-card-mark-wrong.md` — кнопка «Это неверно» на карточках (в UI её нет; backend `recordDecision` готов).

**Файлы-ориентиры:** `backend/prisma/schema.prisma` (Regulation/Decision/Process → currentVersion → CardVersion.trustTier); read-сервисы этих модулей в `backend/src/modules/knowledge-core/`; chat-v2 citations DTO; frontend `app/(authenticated)/{regulations,decisions,insights}/`, `src/domain/*`, чат-компоненты.

---

## Фаза C2 — Крутилки лестницы доверия и напоминаний в AdminSetting (приоритет 2)

**Проблема (человеческим языком):** пороги уверенности, каденция Telegram-напоминаний, окна «срочности», процент аудита — сейчас **константы в коде**. Поменять = программист + релиз. Владелец/супер-админ должен крутить их сам из админки, с историей изменений.

**Что входит:** перевести значения с code-констант на `AdminSetting` (динамические настройки, редактируемые super_admin, с history+audit) через существующую инфраструктуру `AdminSetting` + `AdminSettingsService` + `TypedConfigService.getDynamic` + `AdminSettingField` (см. `feedback_admin_settings_not_env_or_code`; регистрация — `backend/src/modules/admin/settings/admin-setting-schema-registry.ts`).

Ключи (значения = текущие дефолты из кода):
- **Курация (Часть A):** `curation.autoThresholdDefault`, `curation.deepReviewThresholdDefault`, `curation.provisionalThresholdDefault` (0.8), `curation.aiVerifierEnabled` (true), `curation.auditSampleRate` (0.05), `curation.autotuneEnabled` (false), `curation.thresholdMin` (0.6), `curation.thresholdMax` (0.97), `curation.autotuneStep` (0.02), `curation.minDecisionsForAutotune` (20), `curation.maxProvisionalOverride` (0.2).
- **Напоминания (Часть B):** `pendingActions.reminderWindowStartHour` (9), `pendingActions.reminderWindowEndHour` (21), `pendingActions.reminderStepHours` (3), `pendingActions.urgentAgeDays` (5), `pendingActions.reminderLeadDays` / `curation.lifecycleLeadDays` (3 — `LEAD_DAYS` в `pending-actions/providers/curation.provider.ts`).

**Как делать:** для каждого места, где сейчас читается константа (curation.service `normalizeSettings` дефолты; `curation-autotune.cron`; `pending-actions-reminder.cron`; `curation.provider` LEAD_DAYS), заменить на чтение из `getDynamic`/AdminSetting с code-fallback (константа остаётся как fallback, не «источник правды»). **Активные снимки не пересчитывать ретроактивно.** Зарегистрировать поля в registry с типами/диапазонами для UI.

**Что НЕ входит:** менять саму логику порогов; трогать per-Org `curationSettings` (это per-tenant override — остаётся; AdminSetting задаёт **дефолты платформы**).

**Acceptance:**
- [ ] Все перечисленные ключи зарегистрированы в `admin-setting-schema-registry.ts` (тип/диапазон/дефолт/описание RU).
- [ ] Кроны и сервисы читают значения через `getDynamic` (code-fallback при отсутствии записи).
- [ ] Меняешь значение в админке → поведение меняется без релиза; изменения в history/audit.
- [ ] typecheck/lint/тесты зелёные; unit на «getDynamic → используется, fallback при отсутствии».
- [ ] `prod-deploy-log.md` Шаг 1 обновлён (новые AdminSetting + seed дефолтов, если нужен).

**Файлы-ориентиры:** `backend/src/modules/admin/settings/admin-setting-schema-registry.ts`, `backend/src/common/config/typed-config.service.ts` (паттерн `getDynamic`), `curation.service.ts` (`normalizeSettings`), `curation/workers/curation-autotune.cron.ts`, `pending-actions/workers/pending-actions-reminder.cron.ts`, `pending-actions/providers/curation.provider.ts`.

---

## Фаза C3 — Detail-страницы курации для точного deep-link (приоритет 3)

**Проблема (человеческим языком):** напоминание/«Открыть» ведёт на общий список `/curation`, а должно — на **конкретную** карточку, чтобы прочитать и решить (особенно для deep/конфликтов). Сейчас страниц одной карточки и конфликта нет.

**Что входит:**
- **Frontend**: страница `app/(authenticated)/curation/[id]/page.tsx` + клиент — детальная CurationItem: предлагаемый payload, triageReason, уровень/статус, связанные конфликты, действия куратора (approve / approve_with_edits / reject / split / merge / supersede / escalate — для deep обязателен reasoning). Бэкенд готов: `GET /api/v1/curation/items/:id` (`CurationService.getItemById`) + `POST /api/v1/curation/items/:id/decide`.
- **Frontend**: страница конфликтов `app/(authenticated)/curation/conflicts/` (список + резолюция) и/или `conflicts/[id]`. Бэкенд готов: `GET /api/v1/curation/conflicts`, `/conflicts/:id`, `POST /conflicts/:id/resolve|dismiss`.
- **Backend**: вернуть точные `actionUrl` в провайдерах (сейчас `/curation`): `curation.provider.ts` → `/curation/${i.id}`; `conflict.provider.ts` → `/curation/conflicts/${i.id}` (обновить и их spec-ассерты). Точный deep-link из Telegram/колокольчика/дашборда.

**Что НЕ входит:** менять контракты decide/resolve (готовы); RBAC (внутри сервисов).

**Acceptance:**
- [ ] `/curation/[id]` рендерит карточку, действия работают (decide → item уходит из очереди), deep-review требует reasoning.
- [ ] Страница конфликтов: резолюция/dismiss работают.
- [ ] `actionUrl` провайдеров точные; «Открыть» из `/actions`, колокольчика, Telegram ведёт на конкретную карточку (не 404).
- [ ] typecheck/lint/тесты зелёные (вкл. обновлённые provider-спеки).

**Файлы-ориентиры:** `backend/src/modules/curation/curation.controller.ts` (готовые эндпоинты), `pending-actions/providers/{curation,conflict}.provider.ts` + их `*.spec.ts`, frontend `app/(authenticated)/curation/` (есть `page.tsx` очереди — образец), `src/api/curation*.api.ts` (если нет — создать слой).

---

## Общие правила (для всех C-фаз)
- Только `bun run prisma:push` + `prisma:generate` (никогда migrate); но в изолированном worktree — только `prisma:generate`, `db push` на выкате.
- Никакого `process.env.*` в коде; настройки через `TypedConfigService`/`AdminSetting`.
- Frontend: слои ApiDto→DomainModel→UiModel, единый apiClient, SWR; **парные цветовые токены** (никогда `text-white`/hex на цветном).
- Telegram остаётся zero-button.
- LLM-промпты cache-friendly (в этих фазах новых LLM-вызовов быть не должно).
- Тесты обязательны по acceptance; typecheck+lint зелёные; верифицировать правки субагентов (grep/re-Read/прогон тестов).

## Prod-deploy / second-brain
- C2 → `prod-deploy-log.md` Шаг 1 (AdminSetting). C1/C3 — фронтенд + проброс полей, обычно без prod-операций (кроме уже накопленного `prisma db push` из A/B).
- Обновить `second-brain`: `01_projects/admin.md` (крутилки), `02_architecture/knowledge-core.md` (метка доверия в UI), `01_projects/frontend-pages.md` (detail-страницы курации).

## Итог
Остаток ТЗ Action Center: **C1 метка доверия (UI) → C2 крутилки AdminSetting → C3 detail-страницы**. Базовая механика (A0–A2, B0–B5) готова в ветке `feature/action-center-trust-ladder`; эти три фазы — достройка поверх неё.
