# ChatBox (app.agent-lia.ru) — факты по Public API + решения (research для ТЗ)

> Источник: https://app.agent-lia.ru/api-docs/public-json (OpenAPI 3.0).
> Базовый URL: `https://app.agent-lia.ru`, префикс `/api/v1`.
> Авторизация: `Authorization: Bearer <static JWT token>`. Токен — долгоживущий статический, права = права пользователя.
> Тестовый токен (ADMIN, доступ к ~100 воркспейсам) проверен живьём 2026-06-05 — всё читается.
> Название продукта в API: «Call Intellect: Чаты».

## Эндпоинты (все REST, пагинация `limit`/`offset`/`order`(asc|desc)/`search`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/workspaces` | список воркспейсов токена (+role) |
| GET/PATCH | `/workspaces/{ws}` | воркспейс |
| GET | `/workspaces/{ws}/channels` | каналы (мессенджеры) |
| GET/PATCH | `/workspaces/{ws}/channels/{id}` | канал |
| POST | `/workspaces/{ws}/chats` | создать чат с клиентом |
| GET | `/workspaces/{ws}/chats` | чаты (фильтр `status`=ACTIVE/CLOSED) |
| GET | `/workspaces/{ws}/chats/{id}` | чат |
| GET | `/workspaces/{ws}/chats/{id}/messages` | сообщения чата |
| POST | `/workspaces/{ws}/chats/{id}/messages` | **отправить сообщение** (text) |
| GET | `/workspaces/{ws}/chats/{id}/messages/{id}` | сообщение |
| POST | `/workspaces/{ws}/channels/{id}/check-phone` | проверка номера в мессенджере |
| GET/POST | `/workspaces/{ws}/channel-clients` | клиенты каналов |
| GET/PATCH/DELETE | `/workspaces/{ws}/channel-clients/{id}` | клиент канала |
| GET/POST | `/workspaces/{ws}/customers` | кастомеры (унифицированные контакты) |
| GET/PATCH/DELETE | `/workspaces/{ws}/customers/{id}` | кастомер |
| GET/POST | `/workspaces/{ws}/members` | участники (менеджеры) |
| PATCH/DELETE | `/workspaces/{ws}/members/{userId}` | роль/удаление участника |
| GET/POST | `/workspaces/{ws}/webhooks` | вебхуки |
| GET/PATCH/DELETE | `/workspaces/{ws}/webhooks/{id}` | вебхук |
| GET | `/workspaces/{ws}/webhooks/{id}/logs` | логи доставки вебхука |

## Ключевые схемы

**Channel** `{id, title, description, type, isActive, license{id,status,expireDate,title}, createdAt, updatedAt}`
- `type` enum: `CHAT_WIDGET | TELEGRAM | TELEGRAM_PRIVATE | WHATSAPP | WHATSAPP_BUSINESS | WHATSAPP_WHAPI | AVITO | EMAIL_CLIENT | CIAN | VK | MAX | EXT_MAX | EXT_WHATSAPP`

**Customer** (унифицированный контакт) `{id, name, phone, email, externalId(из внешней CRM), createdAt, updatedAt}`

**ChannelClient** (identity клиента в конкретном мессенджере) `{id, name, phone, email, channelType(enum как Channel.type), channelId, customerId(→Customer), externalId(id в мессенджере, напр. telegram user id), isBlocked, avatarUrl, createdAt, updatedAt}`

**Chat** `{id, channelId, status(ACTIVE|CLOSED), client{id,name,phone}(=ChannelClient), responsible{id,name}(=Member|null), createdAt, updatedAt}`

**Message** `{id, chatId, content{text, type, imageUrl, fileUrl, audioUrl, videoUrl}, sender{id, name, type}, createdAt}`
- `content.type` enum: `TEXT | IMAGE | AUDIO | VIDEO | VIDEO_NOTE | FILE | VOICE | COMMAND`
- `sender.type` enum: `ASSISTANT | USER | CLIENT | QUALITY_CONTROL` (CLIENT=входящее от клиента, USER=сотрудник/оператор, ASSISTANT=бот, QUALITY_CONTROL=контроль качества)

**Member** (менеджер/сотрудник воркспейса) `{id, email, name, role(OWNER|ADMIN|MANAGER|USER), createdAt}`

**SendMessageDto** (POST messages) `{text* , type?(только TEXT поддержан)}` — шлётся от имени системы/оператора через мессенджер канала.

**CreatePublicChatDto** `{channelId*, phone?, firstName?, lastName?, telegramUsername?, telegramUserId?}`

**Webhook** `{id, url*, events*[], description, isActive, workspaceId, channelId?(фильтр), createdAt, updatedAt}`
- события enum: `CHAT_CREATED | CHAT_CLOSED | MESSAGE_CREATED | MESSAGE_UPDATED | CHANNEL_CLIENT_CREATED`
- `CreateWebhookDto {url*, events*[], description?, channelId?}`; есть логи доставки.

## Главное открытие: мультимессенджер-объединение уже решено в ChatBox
- `Customer` (один человек) ←→ много `ChannelClient` (по одному на мессенджер), у каждого свой `customerId`.
- Значит склейку «один клиент в разных мессенджерах» НЕ изобретаем — берём `customerId` как ключ объединения, а `ChannelClient.channelType` даёт тип мессенджера.
- Менеджер чата = `Chat.responsible` (Member). Тип мессенджера чата = `Channel.type` (по `chat.channelId`).

## Наблюдения по реальным данным (workspace 246c3062-807b-4367-a376-1d34a4ddc435, 49 чатов)
- Каналы разных типов в одном воркспейсе: TELEGRAM_PRIVATE, EXT_MAX, TELEGRAM, CHAT_WIDGET → мультимессенджер реален.
- Чат остаётся `status=ACTIVE` и просто копит новые сообщения день за днём (не закрывается на ночь). Один и тот же `chat.id` живёт долго.
- `message.sender.type=CLIENT` для входящих; `name` часто null (берём из ChannelClient).
- `channel-clients[].externalId` = telegram user id; `customerId` всегда заполнен.

## Решения владельца (2026-06-05)
1. **Воркспейс:** один воркспейс на org Коры (после ввода токена — `GET /workspaces`, юзер выбирает один). Config интеграции: `token`(enc) + `workspaceId`.
2. **Чаты:** зеркало 1:1 (один Кора-чат = один ChatBox-чат, сообщения дозагружаем инкрементально по `order=asc` + дедуп по внешнему message id). Для LLM-анализа режем тред на «сессии» по паузе (напр. idle-gap >12ч → новая сессия), каждая сессия `linkedToPreviousSessionId`, анализ учитывает контекст предыдущих сессий.
3. **Realtime:** регистрируем webhook ChatBox (`MESSAGE_CREATED`, `CHAT_CREATED`, `CHAT_CLOSED`, `MESSAGE_UPDATED`, `CHANNEL_CLIENT_CREATED`) на публичный endpoint Коры + периодический поллинг как фолбэк/добор. Период синка: hourly / daily / on-new-message(webhook).
4. **Менеджеры:** автосвязка `Member.email` → person/employee Коры, остаток — ручной маппинг в UI.

## Маппинг на код Коры (что переиспользуем)
- **Хранение секретов/настроек**: паттерн модуля `sources` (per-tenant, AES-GCM шифрование `botToken`/`apiKey`, `sanitizeConfigForRead`→`<encrypted>`). ChatBox-интеграция = отдельная таблица (нужно больше полей, чем generic Source) либо новый SourceType + сопутствующие таблицы.
- **AI-анализ**: точка входа `IngestService.ingest({tenantId, sourceId, sourceExternalId, occurredAt, payload, dataClass})` → `RawEvent` (дедуп по sourceExternalId/checksum) → knowledge-core (IdeaBlock+Entity+граф+Theme).
- **Меню**: `frontend/src/ui/components/app-shell/Sidebar.tsx` — `NavGroup → NavSubgroup → NavItem` (есть `gateFeature`, `comingSoon`, `badgeCount`). Добавляем группу «Чаты» → «Интеграции» → «Чат бокс» + раздел просмотра чатов.
- **Существующий `conversational`** — это ВНУТРЕННИЕ чек-ины сотрудников (telegram/max боты), НЕ клиентские CRM-чаты. Новый домен (напр. `messaging`/`chatbox`), не переиспользуем.
- Frontend-слои: ApiDto → DomainModel → UiModel; единый `api-client.ts`; SWR.
- Multi-tenancy: `orgs`+`rbac`, `TenantGuard` (`X-Org-Id`), любой запрос требует `tenantId`.
