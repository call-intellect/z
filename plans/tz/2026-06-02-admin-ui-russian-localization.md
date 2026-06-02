# ТЗ: Русификация админок — устранение англоязычных слов и аббревиатур

> Дата: 2026-06-02
> Тип: UX/локализация, без изменений бизнес-логики
> Статус: черновик (анализ + план; код не начат)
> Связанные правила: `feedback_admin_ui_russian_only.md`, `feedback_language_plain_russian.md`
> Источник копирайта: `delivery/13-glossary.md`, `delivery/ui/copy-strings.ru.md`

## 0. Решения (2026-06-02)

- **Z-Admin — мягкая русификация (П.2 политика B):** переводим переводимое; бренды/протоколы/идентификаторы (S3, LiveKit, BullMQ, LLM, `taskType`) оставляем с русским пояснением в скобках при первом упоминании. Не превращаем в строгую зону A — операторам важна тех. узнаваемость терминов.
- **Типы встреч («Custdev», «Customer Success») — переводим** по `delivery/13-glossary.md` и каталогу типов встреч.

## 1. Цель

Во всех админ-интерфейсах Z не должно оставаться англоязычных слов/аббревиатур, которые непонятны русскоязычному пользователю. Каждое английское слово либо переводится на русский, либо (если это бренд/протокол/технический идентификатор) сопровождается русским пояснением при первом упоминании на странице.

## 2. Две зоны и две политики строгости

В проекте две разные админки с разными аудиториями — политика для них разная.

| Зона | Маршруты | Аудитория | Политика |
|---|---|---|---|
| **A. Админка владельца компании** | `(authenticated)/company-admin/*`, `(authenticated)/settings/admin/*`, общий сайдбар `Sidebar.tsx`, подсказки `nav-help.ts`, тур `overview.ts` | Владелец/админ компании-клиента (НЕ разработчик) | **P0 — строгий ноль английских слов.** Правило `feedback_admin_ui_russian_only.md` применяется буквально. |
| **B. Админка суперадмина (Z-Admin)** | `(admin)/admin/*`, сайдбар `navigation.ts` + `AdminShell.tsx` | Операторы платформы Z (техническая команда) | **P1/P2 — перевести всё переводимое; бренды/протоколы/идентификаторы оставить, но с русским пояснением при первом упоминании.** |

Классы терминов:
- **P0** — обычное английское слово с чистым русским эквивалентом → переводим всегда (обе зоны).
- **P1** — английское слово-метка/колонка/кнопка в Z-Admin, имеющее чистый русский эквивалент → переводим.
- **P2** — бренд (Telegram, LiveKit, DeepSeek), протокол (S3, IMAP, SMTP, TURN, SFU, Egress, OAuth, DLQ), технический идентификатор (`taskType`, `pgvector`, BullMQ, `effectiveFrom`). Не переводим, но даём русское пояснение в скобках при первом упоминании на странице. В зоне A таких быть почти не должно — заменять на бытовой русский.

## 3. Что найдено (сводка аудита)

Аудит выполнен сканированием всех `.tsx` обеих зон + `navigation.ts`, `nav-help.ts`, `Sidebar.tsx`, `overview.ts`. Полная разбивка `файл:строка` — в разделе 6.

### 3.1 Зона A (владелец компании) — P0, критично

| Файл | Английские строки (видимые) |
|---|---|
| `company-admin/sources/SourcesClient.tsx` | «Bot Token», «Bot Username», «API Key», «API Salt», «Webhook URL», «Web-form», «extensions», «LLM», «Knowledge Core», «IMAP-хост», «TLS / SSL», «app password» |
| `company-admin/meetings/MeetingsAdminSettingsClient.tsx` | «Custdev», «Customer Success» (метки типов встреч) |
| `src/ui/components/app-shell/Sidebar.tsx` | «Появится в Фазе γ» (ок, есть в глоссарии); проверить пункт «Суперадмин» (ок) — критичных англ. слов в видимом тексте мало, но см. п.6 |
| `src/lib/nav-help.ts` | в основном уже на русском; проверить отсутствие «Entity Browser», «OKR» без пояснения |
| `src/ui/tour/tours/overview.ts` | проверить пункты тура на англ. вкрапления |

### 3.2 Зона B (Z-Admin) — P1 (перевести)

Сайдбар (`navigation.ts`) и заголовки страниц содержат смешанные англо-русские метки:
- «Функции LLM», «Каталог LLM», «Управление роутами LLM», «Knowledge-Core», «Knowledge-Core настройки», «Concierge и AI-чат», «Эмбеддинги» (уже рус.), «Preference dataset», «Мониторинг signalType», «Entitlements (overrides)», «Email-шаблоны», «Conversational боты», «Webhook subscriptions», «Integration keys», «S3 хранилище», «Воркеры BullMQ», «Feature flags», «Z-Admin», «Глобальная админка super_admin», «Журнал super_admin».

Таблицы/формы (наиболее заметные чистые англицизмы под перевод):
- `llm-prices/LlmPricesClient.tsx`: колонки «Provider», «Model», «Input / 1M», «Output / 1M», «Cached / 1M», «Currency», «Effective».
- `llm/models/LlmModelsClient.tsx`: «Model key», «Verified», «Контекст (tokens)».
- `integrations/bots/BotsClient.tsx`: «Host», «Port», «User», «Folder», «Webhook secret», «rate-limit (RPS)».
- `experiments/[taskType]/ExperimentClient.tsx`: «Model A/B», «Split», «Fail rate», «Avg cost», «Avg latency», «Avg in/out tokens», «Total cost», «Group A/B».
- `content/system-messages/SystemMessagesClient.tsx`: вкладка «Maintenance».
- `content/global-channels/GlobalChannelsClient.tsx`: «Config preview».
- `orgs/entitlements`: «Entitlements (overrides)».
- `ai/prompts/PromptsAiClient.tsx`: вкладка «Feedback».

### 3.3 Зона B (Z-Admin) — P2 (оставить + пояснить)

Бренды/протоколы/идентификаторы, которые остаются английскими, но требуют русского пояснения при первом упоминании на странице:
S3, LiveKit, SFU, Egress, TURN, IMAP, SMTP, OAuth, DLQ, BullMQ, pgvector, RPS, Webhook (→ можно «вебхук»), `taskType`, `effectiveFrom/To`, DeepSeek/OpenAI/Ollama/GigaAM, primary/secondary/tertiary (уже глоссируются как Основной/Запасной/Локальный — закрепить везде).

## 4. Словарь переводов (добавить в `delivery/13-glossary.md`)

Единый источник правды — глоссарий. Перед правкой кода пополнить таблицу глоссария этими парами, дальше код берёт строки только отсюда.

### 4.1 Переводимое (P0/P1)

| Английский | Русский | Примечание |
|---|---|---|
| Bot Token | Токен бота | |
| Bot Username | Имя бота (username) | username оставить в скобках как тех. термин Telegram |
| API Key | Ключ доступа (API-ключ) | |
| API Salt | Соль подписи | |
| Webhook / Webhook URL | Вебхук / Адрес вебхука | |
| Webhook subscriptions | Подписки на вебхуки | |
| Web-form | Веб-форма | |
| extensions (телефония) | Добавочные номера | |
| Knowledge Core / Knowledge-Core | Ядро знаний | в Z-Admin допустимо «Ядро знаний (Knowledge-Core)» при первом упоминании |
| Provider | Провайдер | |
| Model | Модель | |
| Model key | Ключ модели | |
| Currency | Валюта | |
| Effective | Период действия | |
| Input / Output / Cached / 1M | Вход / Выход / Из кэша (за 1 млн токенов) | |
| Verified | Проверено | |
| Host / Port / User / Folder | Хост / Порт / Пользователь / Папка | |
| Webhook secret | Секрет вебхука | |
| rate-limit (RPS) | Лимит частоты (запросов/сек) | |
| Split | Доля трафика | |
| Fail rate | Доля ошибок | |
| Avg cost / Avg latency | Средняя стоимость / Средняя задержка | |
| Avg in/out tokens | Среднее токенов вход/выход | |
| Total cost | Итоговая стоимость | |
| Group A / Group B | Группа A / Группа B | |
| Model A / Model B | Модель A / Модель B | |
| Config preview | Превью конфигурации | |
| Maintenance (вкладка) | Техработы | |
| Feedback (вкладка) | Обратная связь | |
| Feature flags | Флаги функций | |
| Entitlements (overrides) | Права и квоты (переопределения) | |
| Integration keys | Ключи интеграций | |
| Conversational боты | Диалоговые боты | |
| Email-шаблоны | Шаблоны писем | |
| Email-inbox | Входящая почта | |
| Preference dataset | Датасет предпочтений | |
| Мониторинг signalType | Мониторинг типов сигналов | signalType в скобках если нужен тех. якорь |
| Z-Admin | Админ-панель Z | заголовок шелла + `<title>` |
| Глобальная админка super_admin | Глобальная админка (суперадмин) | |
| Журнал super_admin | Журнал суперадмина | |
| Функции LLM / Каталог LLM | Функции ИИ-моделей / Каталог ИИ-моделей | LLM → «ИИ-модели» (или «LLM (языковые модели)» при первом упоминании) |
| Concierge | Консьерж | бренд внутреннего AI-чата; «Консьерж (AI-чат)» при первом упоминании |
| Smoke-тест | Проверка доступности | оставить «smoke-тест» допустимо как тех. термин в Z-Admin |

### 4.2 Бренды/протоколы — оставить, дать пояснение (P2)

| Термин | Пояснение при первом упоминании |
|---|---|
| S3 | облачное хранилище файлов (S3) |
| LiveKit | платформа видеовстреч (LiveKit) |
| SFU / Egress / TURN | медиа-компоненты LiveKit |
| IMAP / SMTP | почтовые протоколы |
| OAuth | протокол авторизации (OAuth) |
| DLQ | очередь недоставленных (DLQ) |
| BullMQ | система фоновых задач (BullMQ) |
| RPS | запросов в секунду (RPS) |
| DeepSeek / OpenAI / Ollama / GigaAM | названия поставщиков ИИ-моделей — не переводятся |

## 5. План работ (фазы)

> Все изменения — только текстовые строки в UI. Бизнес-логика, API-контракты, имена полей/переменных/маршрутов НЕ трогаем. `data-testid`, ключи, enum-значения с бэка не меняем.

- [ ] **Фаза 0. Глоссарий.** Внести таблицы из §4.1–4.2 в `delivery/13-glossary.md` и нужные строки в `delivery/ui/copy-strings.ru.md`. Это контракт перевода.
- [ ] **Фаза 1. Зона A (P0, критично).** Перевести все строки из §3.1. Файлы: `SourcesClient.tsx`, `MeetingsAdminSettingsClient.tsx`, `Sidebar.tsx`, `nav-help.ts`, `overview.ts`. Ноль английских слов в видимом тексте.
- [ ] **Фаза 2. Зона B — сайдбар и заголовки.** `navigation.ts` (метки секций/пунктов), `AdminShell.tsx` («Z-Admin» → «Админ-панель Z», подпись «Глобальная админка super_admin»), `metadata.title` страниц.
- [ ] **Фаза 3. Зона B — таблицы и формы (P1).** Перевести колонки/метки/кнопки из §3.2 по словарю.
- [ ] **Фаза 4. Зона B — пояснения брендов (P2).** Где бренд/протокол из §4.2 встречается первым на странице — добавить пояснение в скобках один раз.
- [ ] **Фаза 5. Защита от регрессий.** Добавить lint/CI-проверку (см. §7), чтобы новые английские слова не просачивались в UI.

## 6. Пофайловый чек-лист (детальные находки)

> Номера строк — на момент аудита 2026-06-02; перед правкой перечитывать файл (строки могли сместиться).

### Зона A
- [ ] `frontend/app/(authenticated)/company-admin/sources/SourcesClient.tsx` — Bot Token (29, 684), Bot Username (703), API Key (850–851), API Salt (853, 867), Webhook URL (362), Webhook (334), Web-form (119, 315), extensions (880), LLM (1322), Knowledge Core (205, 881), IMAP-хост (1068), TLS / SSL (1092), app password (1108). `chat_id`/`setWebhook`/HTTP-заголовки — оставить как тех. (P2), но обрамить русским пояснением.
- [ ] `frontend/app/(authenticated)/company-admin/meetings/MeetingsAdminSettingsClient.tsx` — Custdev (26), Customer Success (29) → русские названия типов встреч (сверить с `delivery/13-glossary.md` и каталогом типов встреч).
- [ ] `frontend/src/ui/components/app-shell/Sidebar.tsx` — проверить весь видимый текст; «Появится в Фазе γ» уже в глоссарии (ок).
- [ ] `frontend/src/lib/nav-help.ts` — проверить отсутствие «OKR»/«Entity Browser» без русского эквивалента.
- [ ] `frontend/src/ui/tour/tours/overview.ts` — проверить пункты тура.

### Зона B — навигация
- [ ] `frontend/app/(admin)/admin/navigation.ts` — метки: «Функции LLM», «Knowledge-Core», «Knowledge-Core настройки», «Concierge и AI-чат», «Управление роутами LLM», «Каталог LLM», «Preference dataset», «Мониторинг signalType», «Entitlements (overrides)», «Email-шаблоны», «Conversational боты», «Webhook subscriptions», «Integration keys», «S3 хранилище», «Воркеры BullMQ», «Feature flags», «Журнал super_admin».
- [ ] `frontend/app/(admin)/admin/AdminShell.tsx` — «Z-Admin» (97), «Глобальная админка super_admin» (118).
- [ ] `frontend/app/(admin)/admin/layout.tsx` — `metadata.title: 'Z-Admin'` (7).

### Зона B — страницы (главные англицизмы)
- [ ] `admin/llm-prices/LlmPricesClient.tsx` — колонки Provider/Model/Input/Output/Cached/Currency/Effective (114–120).
- [ ] `admin/llm/models/LlmModelsClient.tsx` — «Model key» (80), «Verified» (85), «Контекст (tokens)» (83).
- [ ] `admin/llm/providers/LlmProvidersClient.tsx` — «smoke-тест» → «проверка доступности» (или оставить с пояснением).
- [ ] `admin/integrations/bots/BotsClient.tsx` — Host/Port/User/Folder (590–620), Webhook secret (276), Webhook URL (286), rate-limit (RPS) (458).
- [ ] `admin/integrations/webhooks/WebhooksIntegrationsClient.tsx` — «Webhook subscriptions» (62), «DLQ» (40, +пояснение).
- [ ] `admin/integrations/livekit/LiveKitClient.tsx` — «LiveKit health» → «Состояние LiveKit», «Host»/«Ping» (250, 257) +пояснения для SFU/Egress/TURN.
- [ ] `admin/experiments/[taskType]/ExperimentClient.tsx` — Model A/B (166, 170), Split (174), Fail rate (255), Avg cost/latency (259–260), Avg in/out tokens (262), Total cost (265), Group A/B (211).
- [ ] `admin/ai/prompts/PromptsAiClient.tsx` — вкладка «Feedback» (26).
- [ ] `admin/ai/embeddings/EmbeddingsSettingsClient.tsx` — «Batch» (93), «Chunking» (92) +пояснения.
- [ ] `admin/ai/catalog/CatalogClient.tsx` / `SmokeTestClient.tsx` — «Smoke-тесты» (унифицировать формулировку).
- [ ] `admin/content/system-messages/SystemMessagesClient.tsx` — вкладка «Maintenance» (33).
- [ ] `admin/content/global-channels/GlobalChannelsClient.tsx` — «Config preview» (101).
- [ ] `admin/content/emails/EmailTemplateEditor.tsx` — «Handlebars plain text» (139), «Helper-блоки» (150) +пояснение (Handlebars — формат шаблонов).
- [ ] `admin/orgs/entitlements/*` — «Entitlements (overrides)» (51).
- [ ] `admin/orgs/plans/PlansClient.tsx` — «Org» (533).
- [ ] `admin/integrations/tochka/TochkaIntegrationClient.tsx` — «Trigger ensureOAuthReady» (129), блок ENV-переменных (84–88): это тех. инструкция оператору — допустимо оставить, но обрамить русским пояснением «технические переменные окружения».
- [ ] `admin/login/AdminLoginForm.tsx` — «Email» (53) → «Электронная почта» (или оставить с учётом, что это вход оператора).

## 7. Защита от регрессий (Фаза 5)

Чтобы новые англицизмы не появлялись:
1. Скрипт-линтер `frontend/scripts/check-russian-ui.mjs` (или eslint-правило): грепает JSX-текст и строковые литералы `label:`/`title:`/`placeholder:` в `app/(admin)` и `app/(authenticated)/company-admin` на латиницу; список исключений (бренды/протоколы из §4.2) — в allowlist-файле.
2. Прогон в CI на изменённых файлах фронтенда.
3. Документировать в `second-brain/01_projects/admin.md` правило «UI-строки только из глоссария».

## 8. Критерии приёмки

- [ ] Зона A: при ручном проходе по всем страницам владельца компании англоязычных слов в видимом тексте нет (кроме брендов с русским пояснением).
- [ ] Зона B: сайдбар, заголовки страниц, колонки таблиц и метки форм — на русском; бренды/протоколы сопровождены пояснением при первом упоминании.
- [ ] `delivery/13-glossary.md` пополнен; все новые строки берутся оттуда.
- [ ] `bun run typecheck` и `bun run lint` во `frontend/` зелёные.
- [ ] Линтер русификации (§7) проходит на изменённых файлах.
- [ ] Бизнес-логика, маршруты, имена полей/enum/`data-testid` не изменены.

## 9. Вне рамок

- Перевод внутренних имён переменных/функций/маршрутов/enum.
- Перевод тех. документации и кода (глоссарий это явно разрешает оставлять на английском).
- Данные, приходящие с бэка как значения (имена моделей, ключи) — не переводятся; при необходимости добавляется русская подпись рядом.

## 10. Итог

Реализация не начата (это документ-ТЗ). Готово к старту с Фазы 0 (глоссарий) по явной команде.
