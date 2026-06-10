# Плотная ревизия технических протечек в кабинете Коры — реестр и план фиксов

> Дата: 2026-06-10. Метод: мульти-агентный код-аудит (workflow `w91hzyb4e`, 11 агентов) + живой обход кабинета (Playwright, прод korateam.ru) + ручной разбор.
> Полный машинный результат (все 186 находок): `tasks/w91hzyb4e.output` (JSON).
> Живые находки + скриншоты: [`2026-06-10-ui-leaks-live/`](2026-06-10-ui-leaks-live/).

## Что искали

«Технические протечки» — всё, что НЕтехнический бизнес-пользователь видеть не должен, но видит: сырой JSON, внутренние ID (cuid), английские enum/коды, утечки текста ошибок, непереведённые тех-термины, отладочные заглушки.

## Сводка: 186 находок

| Категория | Кол-во | Что это |
|---|---|---|
| error-leak | 65 | `error.message`/`HTTP 500`/код ошибки в тостах и баннерах |
| english-code | 45 | сырые enum латиницей (`contradicts`, `idea_block`, `standup`, типы/статусы) |
| internal-id | 28 | cuid (`cmq…`) как заголовок/подпись вместо имени |
| untranslated | 25 | англ. слова/коды ролей в видимом тексте |
| raw-json | 12 | `<pre>{JSON.stringify(...)}</pre>` |
| placeholder-debug | 11 | TODO, dev-заглушки, ручной ввод id |

По важности: **high 44 · med 81 · low 61**.

## 6 классовых фиксов (чиним КЛАСС, не кейс)

1. **Единый рендер ошибок** (закрывает ~65). Корень — [`api-client.ts:66`](../../frontend/src/api/api-client.ts#L66): `message = "HTTP <status>"` всплывает в тостах по всему кабинету. → `humanizeApiError()` + русские фолбэки по коду/статусу + тост через хелпер. **СДЕЛАНО (core):** `api-error.ts` (`humanizeApiError`, `httpStatusFallbackRu`, словарь кодов), `api-client.ts` (русский фолбэк), `useSwrWithToast.ts`. Осталось: точечная замена прямых `e.message`/`setError(e.message)`/`<AdminError message={err.message}>` на `humanizeApiError(e)` (~40 мест).
2. **Общий маппер enum→RU** (закрывает ~45). Словари уже есть в `domain/*` (MEETING_TYPE_LABEL, entityTypeLabel, signalTypeLabel, relationLabel, conflictRelationLabel, IDEA_STATUS_LABEL…), но в местах ниже выводят сырое поле в обход маппера. → прогонять через маппер; где словаря нет (роли/taskType/статусы доставки/toolName консьержа/ChatBox role) — завести; убрать опасные `?? rawCode`.
3. **Не показывать cuid** (закрывает ~28). Резолвить id в имя/название (на бэке в DTO или people-резолвером на фронте). Не показывать `resourceId`/`existingId`/`parentId`/обрезанные cuid как заголовки/подписи.
4. **Сырой JSON → человеческий рендер** (закрывает ~12). `<pre>{JSON.stringify}</pre>` (курация: triageReason/proposedPayload; entities: attributes; me/notifications: response) → рендер полей или скрыть под «технические детали» (только админ).
5. **Убрать отладочные заглушки / ручной ввод id / dev-плейсхолдеры** (закрывает ~11).
6. **Локализация UI-копий** (закрывает ~25). Англ. термины и коды ролей из видимого текста — в русские.

## Уже исправлено (этой сессией)

- ✅ Класс ошибок — **core** (см. фикс №1): `api-error.ts` / `api-client.ts` / `useSwrWithToast.ts`. Убирает «HTTP 500»/коды из всех тостов на общем пути.
- ✅ Деталь конфликта `/curation/conflicts/[id]` — сырой JSON «Доказательства» + cuid + `IDEA_BLOCK`/`contradicts`/`block-linker` → человеческий вид (ConflictDetailClient + `resourceTypeRu` lowercase + `conflictRelationLabel`).

## Топ high-severity, ждут фикса (примеры)

- **Курация/Подтверждения (тот же класс):** `CurationDetailClient.tsx:311/346/354`, `CurationQueueClient.tsx:298/398/415/422`, `ConflictsListClient.tsx:172` — cuid как заголовок + `JSON.stringify(triageReason/proposedPayload)`. **+ список `/actions`: `Конфликт карточек: idea_block`, `Требует проверки: idea <cuid>`, `knowledge_profile <cuid>`** (живая находка).
- **Отчёт встречи (флагман):** `ReportsTab.tsx:232` — «Ошибка: llm_dispatch_timeout»; **живьём также `SUMMARY` / `ACTION ITEMS` (англ. заголовки) и `Алексейhost` (роль приклеена к имени)**.
- **Карточки:** `CardDetailClient.tsx:301/392` — сырые коды типа/статуса встречи (`daily`, `ai_ready`…).
- **Граф сущностей:** `EntityGraphClient.tsx:404/423/505` — `contradicts`/`related_to`, JSON-атрибуты, `person`/`project`.
- **Темы:** `ThemeDetailClient.tsx:203/231` — `task_created`/`PERSON`/`ORG_UNIT`.
- **Входящие:** `IntakeClient.tsx:403/409/424` — проект/исполнитель/цель показаны как обрезанный cuid.
- **Консьерж:** `ConciergeChat.tsx:213/248/281/290` — `create_table`/`infer_table_schema` (имена инструментов латиницей).
- **Цели:** `GoalDetailClient.tsx:179` — тост «Quota exceeded …».
- **Эксперименты:** `ExperimentDetailClient.tsx:134/137` — `ID: cmq…`, `entityId: cmq…`.

## Новые зоны (критик полноты)

- **`/orchestrator/*`** — массовая протечка (заголовки «Research-run»/«Orchestrator», `run.id`, `agentType`, англ. Focus/Citations, `type:id`, `${ev.code}: ${ev.message}`). Developer-facing, но под `(authenticated)` — видно бизнес-пользователю. Рекомендация: спрятать раздел от обычных ролей ИЛИ локализовать.
- **`/support/*`** (4 файла) — сырой `ticket.status` (domain/support.ts пробрасывает без маппера).
- **`/team-templates/[slug]`** — сырой JSON `definition` + `category`.
- Точечно: PersonDetail `entity.type`, CloneDetail `trait.category`, AcceptInvitation `role`, me/channels `code.kind`, голосовые входы (`humanizeError`→`err.message`).
- **`/(admin)/**`** — десятки `<pre>`/JSON/taskType-кодов, НО это super_admin (severity low, приемлемо; отдельным проходом при желании).

## План фиксов (волнами)

- **W1 (ядро + самое видимое):** ✅ класс ошибок core; конфликт-деталь ✅; → курация-класс (CurationDetail/Queue/ConflictsList + `/actions`), отчёт встречи (SUMMARY/ACTION ITEMS/host/код ошибки).
- **W2 (enum→RU):** прогнать обходы мапперов (cards, entities-graph, themes, sprints, weekly, concierge tool-names, chatbox role) + убрать `?? rawCode`.
- **W3 (cuid→имя):** intake, projects/settings, issue-comments, experiments + общий people/resource-резолвер.
- **W4 (raw-json + placeholder):** `<pre>JSON` → поля; убрать TODO/dev-заглушки.
- **W5 (зоны):** orchestrator (скрыть/локализовать), support-статусы, team-templates.
- **W6 (по желанию):** admin-поверхности.

> Прод: всё — чистый фронтенд (без миграций/ENV). Выкат — `docker compose up -d --build` после мержа.
