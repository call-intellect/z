---
type: tz
status: ready
feature: cabinet-assistant-clone-selector — выпадающий селектор «общий помощник / клон должности» у окна ввода AI-чата компании (кабинет)
date: 2026-06-15
area: frontend/chat-v2 (+ verify backend clones route)
owner: Сергей (sergrv80)
related:
  - plans/tz/2026-06-15-chat-v2-unified-answer-prompt.md   (решение 8: клон — НЕ режим chat-v2; UI-селектор вынесен сюда)
  - plans/tz/2026-06-14-assistant-router-dedup-and-prompt.md (понимание/синтез по одному разу)
  - second-brain/01_projects/clones.md
---

# Кабинет: селектор «помощник / клон должности» у окна ввода AI-чата

## 1. Цель и контекст

В кабинетном AI-чате компании (`/chat`) по умолчанию отвечает **общий помощник
Коры**. Владелец хочет рядом с окном ввода **выпадающий список**, через который
можно выбрать **конкретную должность (ролевой клон)** и задать вопрос именно ему
(«как ответил бы наш маркетолог»). По умолчанию выбран помощник; клон — опционально.

Это явно вынесено из chat-v2 ТЗ (2026-06-15, решение 8 + Scope «Не входит»):
«Клон выбирается человеком из выпадающего меню в кабинете (как выбор модели); по
умолчанию — общий помощник. Через Telegram — только общий помощник, клоны
кабинет-онли. UI-селектор + маршрутизация — отдельное ТЗ.» Это — то ТЗ.

## 2. Принятые решения (доказаны картой кода, см. §6)

1. **Маршрут — существующий `POST /api/v1/clones/roles/:roleId/ask`, НЕ новый
   параметр в chat-v2 ask.** Обоснование: (а) chat-v2 ТЗ решение 8 — «клон НЕ
   режим chat-v2»; добавить `roleId` в `PostChatV2MessageBodySchema` = втянуть
   клона обратно режимом, против ТЗ; (б) route клона уже несёт RBAC
   (`canAccessRoleClone`), квоту (`AiChatQuotaService`, общую с помощником),
   dialog-layer, grounding-гейты, персистентность в `ChatV2Conversation` и журнал
   `CloneQueryLog` — дублировать это в chat-v2 нельзя; (в) «понимание/синтез по
   одному разу»: путь клона прогоняет dialog-layer ровно один раз внутри
   `askRoleV2`, путь помощника — один раз внутри chat-v2; пути НЕ пересекаются.
2. **Фича — преимущественно фронтовая.** Бэкенд-маршрут готов; backend-изменений
   в идеале ноль (только верификация контракта `askRole` и его ответа).
3. **Список — только ролевые клоны (по должности), `status='active'`.** Источник —
   готовый `GET /api/v1/clones` через хук `useClones(orgId)`. Персональные клоны
   (person-scope) в кабинетный селектор НЕ выводим (память проекта: клоны ролевые).
4. **Дефолт = общий помощник.** Селектор инициализируется `{kind:'assistant'}`;
   `cfg.chatV2.defaultMode` и путь помощника (`streamChatV2Message`/`chatV2Api.ask`)
   не меняются.
5. **Лента (v1):** одна видимая нить в окне `/chat` (клиентская склейка сообщений),
   адресат каждого нового вопроса задаётся селектором. Персистентность —
   по-конвейерно: вопрос помощнику пишется в org-ленту chat-v2, вопрос клону —
   в его собственную clone-ленту (route `askRole` создаёт/использует свою
   `ChatV2Conversation` scope=card). «Единая СОХРАНЁННАЯ смешанная нить» —
   **vNext** (потребовала бы бэкенд-рефактора хранения mixed-addressee, против
   решения 8 chat-v2). v1-ограничение задокументировать в `04_не-сделано`.
6. **Права:** показываем клонов, к которым у пользователя есть доступ
   (`useMyCloneAccess`); недоступные — либо скрыты, либо с пометкой «нет доступа»
   и действием «Запросить доступ» (`clonesApi.requestAccess`). При выборе
   недоступного клона `askRole` вернёт 403 — обрабатываем как сообщение «нет
   доступа», не как тех-ошибку.
7. **Telegram/мессенджеры не затрагиваются** — селектор только в кабинете
   (`ChatV2Client.tsx`, опц. `MobileAskClient`). Канал всегда = общий помощник.
8. **UX клона:** у клона нет SSE-стрима стадий (синхронный `askRole`) — показываем
   обычный спиннер «Кора думает…»; `refused:true` (`topic_starved`/`ungrounded`) —
   нормальный ответ, рендерим `text` как сообщение клона, не как ошибку.

## 3. Архитектура: было → стало

**Было:** окно `/chat` (`ChatV2Client.tsx`) шлёт только `{question, conversationId, asOf}`
→ всегда общий помощник (synthetic/org). Селектора нет. «Клон через chat-v2» —
хрупкий трюк `scope='card'+scopeRefId=personId+mode=clone_style` (person-only, UI
им не пользуется; chat-v2 ТЗ его удаляет).

**Станет:** у окна ввода — компактный селектор адресата. `{kind:'assistant'}` (дефолт)
→ прежний путь помощника (стрим). `{kind:'clone', roleId, roleName}` → синхронный
`clonesApi.askRole(orgId, roleId, {question, conversationId})`; ответ маппится в тот
же `ChatV2Message`-shape (текст + citations) и рендерится в общей видимой нити,
помеченный именем клона.

## 4. Scope

**Входит (frontend):**
- Компонент-селектор адресата у окна ввода в `ChatV2Client.tsx` (Radix Select,
  парные цвет-токены, только русский). Дефолт — «Кора · помощник компании».
- Источник списка — `useClones(orgId)` (active role-clones) + `useMyCloneAccess(orgId)`
  для доступа. Пустой список клонов → селектор скрыт (остаётся только помощник).
- Состояние `selectedTarget` в `ConversationDetail`; ветвление в `onSubmit`;
  маппер ответа клона (`AskCloneResponseApi`) → `ChatV2Message` (citations).
- Спиннер для клон-режима; обработка `refused`, 403 (нет доступа), 429 (квота).
- Заголовок диалога/плейсхолдер ввода отражает выбранного адресата.

**Входит (backend — только верификация, правок в идеале нет):**
- Подтвердить контракт `POST /api/v1/clones/roles/:roleId/ask` и форму
  `AskCloneResponseDto` (текст+citations+refused). Если фронт-клиент `askRole`
  не покрывает нужные поля ответа — дописать маппер (фронт).

**Не входит:**
- Новый параметр клона в `PostChatV2MessageBodySchema` (решение 1 — против).
- Единая СОХРАНЁННАЯ смешанная нить помощник+клон (vNext, §2.5).
- Изменение `synthesis.service.ts` (удаление `clone_style`-ветки делает chat-v2 ТЗ;
  здесь не дублируем; порядок: ТЗ#5 после chat-v2 в цепочке).
- Person-scope клоны в селекторе; клон в Telegram/мессенджерах.
- SSE-стрим для клона (vNext).

## 5. Изменения в коде (карта)

| Файл | Что делаем |
|---|---|
| `frontend/app/(authenticated)/chat-v2/ChatV2Client.tsx` | Состояние `selectedTarget`; рендер селектора у формы ввода (~:451-506); ветвление в `onSubmit` (~:287): assistant→`streamChatV2Message`/`chatV2Api.ask` (как есть), clone→`clonesApi.askRole`; маппер ответа клона в `ChatV2Message`; заголовок/плейсхолдер по адресату; спиннер клон-режима; обработка refused/403/429. |
| `frontend/src/ui/components/chat-v2/AssistantTargetSelect.tsx` (новый) | Дропдаун: «Кора · помощник» (дефолт) + список ролевых клонов (publicName/roleName + departmentName, опц. метка доступа). Radix Select, парные токены, русский. |
| `frontend/src/domain/chat-v2.ts` | Маппер `cloneAnswerToChatV2Message(api: AskCloneResponseApi): ChatV2Message` (citations: `CloneCitationApi`→`ChatV2Citation`). |
| `frontend/src/hooks/useClones.ts`, `frontend/src/api/clones.api.ts` | Переиспользуем как есть (`useClones`, `useMyCloneAccess`, `clonesApi.askRole`, `requestAccess`). Правок не предполагается. |
| `frontend/src/ui/mobile/shared/MobileAskClient.tsx` | (если покрываем мобильный кабинет) аналогичный компактный селектор. По умолчанию — да, мобильный кабинет это тоже кабинет; если композер сильно отличается — вынести в vNext-строку. |
| backend `clones.controller.ts:213` / `clones.service.ts:456` (`askRole`) | Только верификация контракта; правок не ожидается. |

## 6. Доказательная база (карта кода, верифицировано)
- chat-v2 ask: `chat-v2.controller.ts:85` (`POST /api/v1/chat-v2/messages`), DTO
  `chat-v2.dto.ts:36` — полей persona/role нет; дефолт mode=synthetic, scope=org.
- Клон роли: `clones.controller.ts:213` → `clones.service.ts:456` (`askRole`/`askRoleV2`),
  ответ `clones/dto/clones.dto.ts:42` (`AskCloneResponseDto`: text, citations, refused).
- Список клонов: `clones.controller.ts:73` (`GET /api/v1/clones`) → `useClones.ts:40`.
- Доступ: `useMyCloneAccess.ts` (`GET /api/v1/me/clone-access`); RBAC `rbac.service.ts:554`.
- Композер без селектора: `ChatV2Client.tsx:297-301,451-506`; фронт-клиент
  `clones.api.ts:234` (`askRole`).
- Двойной dialog-layer риск при «roleId в chat-v2 ask»: chat-v2 уже гоняет
  `DialogService.process` (`chat-v2.service.ts:146`), `askRoleV2` — тоже
  (`clones.service.ts:1067`). Отдельный маршрут исключает задвоение.

## 7. DoD
- [ ] У окна ввода `/chat` есть селектор; дефолт — «помощник», список ролевых клонов.
- [ ] Выбор клона → `clonesApi.askRole(orgId, roleId, …)`; ответ (текст+citations)
      рендерится в нити; помечен именем клона.
- [ ] Помощник (дефолт) — путь не изменился (стрим), регресс зелёный.
- [ ] Пустой список клонов → селектор скрыт (только помощник).
- [ ] `refused` клона — сообщение, не ошибка; 403 — «нет доступа» + «Запросить доступ»;
      429 — как у помощника.
- [ ] Telegram/мессенджеры не затронуты (правок в conversational/concierge нет).
- [ ] `bun run typecheck` + `bun run lint` + `bun run build` (frontend) зелёные;
      `bun run test:unit` (новые тесты компонента/маппера).

## 8. Тесты (frontend)
- unit маппер `cloneAnswerToChatV2Message`: citations и refused→message.
- компонент `AssistantTargetSelect`: дефолт=помощник; рендер списка; пустой список → не показываем; недоступный клон → метка/действие.
- `ChatV2Client` onSubmit ветвление: assistant→stream вызван; clone→askRole вызван с roleId; ответ клона добавлен в messages.

## 9. Риски
- **Двойной dialog-layer** при ошибочном «roleId в chat-v2» — исключён решением 1.
- **Рассинхрон ленты (v1):** клон-сообщения не перезагружаются в `/chat` (живут в
  clone-ленте). Митигейт: документируем как v1-ограничение; «единая сохранённая
  нить» — vNext (`04_не-сделано`).
- **CLONE_V2 доступ:** при `CLONE_V2_ENABLED` доступ только по `CloneAccessGrant` —
  селектор фильтрует/помечает по `useMyCloneAccess`, иначе 403. Проверить актуальное
  состояние флага в `docs/operations/feature-flags.md` при реализации.
- **Mobile-композер** может сильно отличаться — если интеграция дорогая, мобильный
  селектор → отдельная строка vNext (не блокирует desktop).

## 10. Prod-операции (при выкате)
- Миграций/ENV/seed нет (бэкенд-маршрут готов). Чисто фронтовая выкатка:
  `frontend` build + deploy. Backend `docker compose up -d --build` не требуется,
  если backend не менялся.

## Итог
Не реализовано (ТЗ написано 2026-06-15). Реализация — в составе цепочки помощника
ПОСЛЕ chat-v2 (ТЗ#2), как ТЗ#5.
