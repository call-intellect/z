# Calendar External Sync — интеграции с внешними календарями и трекерами РФ

**Дата:** 2026-05-25
**Статус:** черновик, ждёт scope-решения от пользователя
**Срок:** 17-22 дня на полный F1-F4; первая итерация 5-7 дней (только F1)
**Owner:** Sergey
**Базовый план:** [plans/tz/2026-05-25-calendar-mvp.md](2026-05-25-calendar-mvp.md) (Фаза 3 «внешний синк», теперь раскрыта детально)
**Research:** background-агент 2026-05-25 (~5000 слов) — изучены Я.Календарь, Mail.ru, VK WorkSpace, MyOffice, R7, Google, MS Outlook, iCloud, Я.Трекер, Битрикс24, Pyrus, Kaiten, ПланФикс, WEEEK, YouGile, Shtab, CommuniGate.

## Контекст и цели

После Calendar MVP пользователь смотрит в наш `/me/calendar` или `/projects/.../calendar`. Но **в РФ-бизнесе все живут в Я.Календаре / Битриксе / Outlook**, и копировать события туда вручную никто не будет. Без двусторонней синхронизации внешний пользователь не примет наш календарь как «единый источник».

ICS-feed (1-way) уже работает (Фаза 2.2): подписался — события из Z видны в Я.Календаре/Outlook. Но **обратно** события из Google не попадают, и AI не знает что у пользователя забронировано в Google.

**Цель:** 2-way синхронизация: внешние события подтягиваются в Z (учитываются Concierge при `find_free_slot`), наши события улетают наружу при изменениях.

## Архитектурные решения

### Решение 1: Гибридная архитектура (НЕ единый CalDAV, не отдельные адаптеры под каждый)

- **CalDAV provider universal** — один класс `CalDavProvider` (на `tsdav` npm). Покрывает Я.Календарь, iCloud, VK WorkSpace, R7-Офис, CommuniGate Pro **одним кодом** — разные продукты это разные `baseUrl` + способ auth.
- **GoogleCalendarProvider** — нативный REST + watch-channels (push webhooks). Отдельно от CalDAV, потому что у Google настоящие push и delta-sync — UX в разы лучше.
- **MicrosoftGraphProvider** — REST + `/subscriptions`. По запросу enterprise.
- **TrackerProviders (Я.Трекер, Битрикс24)** — отдельные, у них своя семантика (задачи vs события).

### Решение 2: Хранение токенов

Модель `CalendarConnection`:
```
model CalendarConnection {
  id                  String   @id @default(cuid())
  tenantId            String
  userId              String
  provider            String   // 'caldav_yandex' | 'caldav_mailru' | 'google' | 'microsoft' | 'yandex_tracker' | 'bitrix24'
  externalUserId      String   // login или email во внешней системе
  accessTokenEnc      String   @db.Text // AES-256-GCM encrypted
  refreshTokenEnc     String?  @db.Text
  syncToken           String?  // для incremental (Google: nextSyncToken, CalDAV: sync-token)
  lastSyncedAt        DateTime?
  webhookChannelId    String?  // Google watch channel id
  webhookExpiresAt    DateTime? // Google watch expires 7 дней
  config              Json?    // baseUrl для CalDAV, calendarId для Google, etc.
  status              String   @default("active") // active | error | disconnected
  errorMessage        String?  @db.Text
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([userId, provider])
  @@index([webhookExpiresAt]) // для renewal cron
}
```

Шифрование токенов — через существующий `common/crypto` (AES-256-GCM). Токены **никогда** не отдаются на frontend.

### Решение 3: External link на Event

Расширение `Event` (уже есть поля `externalProvider` + `externalEventId` от Фазы 1, теперь активно используем):
```
externalProvider     // 'google' | 'caldav_yandex' | ...
externalEventId      // id события у провайдера
externalEtag         // ETag CalDAV или etag Google (для конфликт-резолюции)
externalUpdatedAt    // updatedAt у провайдера (для last-write-wins)
externalSyncedAt     // когда последний раз pull/push был успешным
```

Pull в Z: создаём Event с этими полями. Push наружу: при создании/изменении нашего Event — асинхронно ставим job в очередь.

### Решение 4: Конфликт-резолюция

**Last-write-wins по `updatedAt`** + аудит расхождений. Если оба меняли (race):
- Сравниваем `event.updatedAt` (наш) vs `externalUpdatedAt` (свежий pull).
- Кто свежее — побеждает.
- Проигравшая сторона получает уведомление в notification feed: «Ваше изменение события {title} перезаписано версией из {provider}».
- **Soft-merge:** если изменены **разные** поля (например, мы поправили location, они — endAt) — мержим без overwrite. Реализуем на уровне field-by-field diff.

### Решение 5: Polling vs webhooks

Гибрид:
- **Google/Microsoft** — webhook (`watch` / `/subscriptions`) + safety-net polling раз в час (Google прямо рекомендует — push «not 100% reliable»).
- **CalDAV (Яндекс и компания)** — только polling 5-10 мин через sync-token (incremental, дёшево). Кастомного pubsub нет.
- **Я.Трекер** — polling через their API. У них есть outgoing webhooks через триггеры с HTTP-запросом, но настройка ручная (триггер в очереди). На MVP — polling.
- **Битрикс24** — outgoing webhooks нативно (`OnCalendarEntryAdd/Update/Delete` + `OnTaskUpdate`). Webhook-based с самого начала.

### Решение 6: Трекеры — односторонне в наш календарь

**Не встраиваемся плагином в Я.Трекер/Битрикс/Pyrus.** Наоборот: задачи с `dueDate` из их трекера → создаём у нас локальный `Event { kind: 'deadline', externalProvider, externalEventId, projectId? }`.

Обратное (из нашего календаря в их трекер) — **не делаем в MVP**. По обзорам российских трекеров большинство хочет «покажи мои задачи и встречи в одном календаре», двусторонняя путаница не нужна.

### Решение 7: Архитектура воркеров

Очередь `core.calendar-sync` (BullMQ). Два типа job:
- **`incremental-pull`** — `{connectionId}`. Триггерится cron'ом 5-10 мин (CalDAV / Я.Трекер) или входящим webhook'ом (Google/Microsoft/Битрикс24). Выполняет incremental sync через syncToken/ETag.
- **`push-to-external`** — `{connectionId, eventId, op: 'create'|'update'|'delete'}`. Срабатывает на наши `event.created/updated/deleted` (через EventEmitter2 — уже есть в P1). Push изменение в каждую активную CalendarConnection user'а.

Воркеры: `calendar-sync.worker.ts` (concurrency=4), `calendar-watch-renewal.cron.ts` (раз в 6 часов обновляет Google watch channels до их `webhookExpiresAt`).

## Фазы

### F1 — Универсальный CalDAV-провайдер (Я.Календарь + iCloud + VK + R7 + CommuniGate)

**Что:**
1. Установить `tsdav` (npm). Проверить совместимость с нашим Node 20 / Bun.
2. Класс `CalDavProvider` в `backend/src/modules/calendar-sync/providers/caldav.provider.ts`:
   - `connect({baseUrl, username, password})` — проверка соединения, получение списка календарей.
   - `pull({connection, since: syncToken?})` — PROPFIND, parse iCal VEVENT, маппинг в наш Event.
   - `push(event, op)` — PUT/DELETE через CalDAV.
   - Обработка ETag для конфликтов.
3. UI «Подключить календарь»: страница `/me/settings/calendars`. Drop-down «Яндекс / Mail.ru / VK / R7 / iCloud / Custom CalDAV». Для каждого — инструкция получения app-password (ссылка + текст).
4. Маппинг приложений: для Я.360 предложить **OAuth через сервисное приложение** (если успеем) ИЛИ app-password как fallback.
5. Worker `calendar-sync.worker.ts` + cron polling каждые 10 мин для всех `CalendarConnection.provider startsWith 'caldav_'`.

**Что покроет:** Я.Календарь, iCloud, VK WorkSpace, R7-Офис, CommuniGate Pro — все одним кодом.

**DoD:** подключить Я.Календарь к тестовому Z-аккаунту → событие созданное в Я.Календаре появляется в /me/calendar за ≤10 мин. Обратно: событие созданное в Z улетает в Я.Календарь.

**Время:** 5-7 дней.

### F2 — Google Calendar (push webhooks + delta sync)

**Что:**
1. OAuth 2.0 flow: страница «Подключить Google». Scope `https://www.googleapis.com/auth/calendar`.
2. `GoogleCalendarProvider`:
   - `pull` через `events.list?syncToken=...` (incremental).
   - `push` через `events.insert/update/delete`.
   - `watch` (push channel) на основной календарь user'а. Webhook callback `POST /api/v1/calendar-sync/google/webhook/:connectionId`.
3. Webhook controller — публичный, проверяет `X-Goog-Channel-Id` + `X-Goog-Resource-State`, ставит `incremental-pull` job.
4. Renewal cron — за день до expiry (7-дневный лимит Google) обновляет watch channel.

**Время:** 4-5 дней.

### F3 — Я.Трекер pull задач

**Что:**
1. OAuth 2.0 / IAM token flow.
2. `YandexTrackerProvider`:
   - `pull` — `GET /v2/issues?perPage=...` фильтр по `assignee = user.email`, `dueDate IS NOT NULL`.
   - Маппинг Issue → Event { kind: 'deadline', sourceUrl, externalProvider: 'yandex_tracker', externalEventId: issueKey }.
3. Polling cron каждые 30 мин (rate limit Я.Трекера экономит сами знаешь).
4. Без push: если пользователь изменил event у нас — НЕ синхронизируем обратно в Я.Трекер (это не «событие», это «задача», семантика расходится).

**Время:** 3-4 дня.

### F4 — Битрикс24 (календарь + задачи через webhooks)

**Что:**
1. OAuth 2.0 + Local webhooks support.
2. `Bitrix24Provider`:
   - Регистрация event handlers через `OnCalendarEntryAdd/Update/Delete` (для событий) и `OnTaskAdd/Update` (для задач).
   - `pull` через `calendar.event.get.nearest` (events) + `tasks.task.list` (tasks).
   - `push` через `calendar.event.add/update/delete`.
3. Один коннектор покрывает оба сценария (events ↔ events, tasks → events {kind=deadline}).

**Время:** 5-6 дней.

### F5 — Microsoft Graph (Outlook) — по запросу enterprise

**Что:** OAuth, `/subscriptions` с webhook, delta query. Аналог Google по структуре.

**Время:** 5-6 дней.

### F6 — Конфликт-резолюция + observability

**Что:**
1. Last-write-wins реализован в `calendar-sync.worker.ts`.
2. Soft-merge field-by-field в `CalendarSyncService.resolveConflict()`.
3. Страница `/me/settings/calendars/sync-log` — последние 100 конфликтов + успешных sync.
4. Метрики prom-client: `calendar_sync_pull_total{provider, success}`, `calendar_sync_push_total{provider, success}`, `calendar_sync_conflicts_total{provider, resolution}`, `calendar_sync_lag_seconds{provider}`.
5. Уведомления пользователю в notification feed на конфликты.

**Время:** 3-4 дня.

### F7 — По запросу: VK WorkSpace отдельно, Pyrus, Kaiten, WEEEK, YouGile

CalDAV-провайдер из F1 уже покроет VK WorkSpace. Остальные — добавляются как мелкие коннекторы по 1-2 дня каждый, когда конкретные клиенты попросят.

## Impact list

**Новые модели Prisma:**
- `CalendarConnection` — токены и конфиг (см. Решение 2)

**Расширения существующих:**
- `Event` — поля `externalEtag`, `externalUpdatedAt`, `externalSyncedAt` уже частично есть, дописать.

**Новые модули:**
- `backend/src/modules/calendar-sync/` — controller (для webhooks), providers (CalDAV, Google, ...), services, workers, cron.

**ENV новые:**
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`
- `YANDEX_OAUTH_CLIENT_ID`, `YANDEX_OAUTH_CLIENT_SECRET`
- `BITRIX24_OAUTH_CLIENT_ID`, `BITRIX24_OAUTH_CLIENT_SECRET`
- `CALENDAR_SYNC_POLL_INTERVAL_MIN` (default 10)

**Косвенные:**
- `second-brain/01_projects/calendar.md` — секция «Внешние интеграции»
- `second-brain/02_architecture/data-model.md` — CalendarConnection
- `second-brain/01_projects/workers-queues.md` — calendar-sync.worker, calendar-watch-renewal.cron

## Открытые вопросы для решения по scope

1. **Какой объём в первой итерации?** Варианты:
   - **A) Только F1 (CalDAV универсальный)** — 5-7 дней. Покрывает Я.Календарь сразу + ещё 4 продукта. Минус: нет Google push (поллинг 10 мин).
   - **B) F1 + F2 (CalDAV + Google)** — 9-12 дней. Лучшее покрытие, Google с push.
   - **C) F1 + F3 (CalDAV + Я.Трекер)** — 8-11 дней. Я.Календарь+ задачи Я.Трекера — для тех у кого всё в Яндекс-экосистеме.
   - **D) F1-F4 (всё) полностью** — 17-22 дня. ~70% рынка РФ.
   - **Рекомендация:** B (F1+F2) — закрывает 60% реальной аудитории, и Я.Кал, и Google. F3/F4 — отдельной итерацией после валидации.

2. **OAuth-приложения** — кто регистрирует developer accounts в Я.Облаке / Google Cloud / Bitrix Marketplace? Это не код, это бюрократия.

3. **Multi-calendar у одного user** — может ли быть и Я.Календарь, и Google одновременно? Да, по схеме `CalendarConnection @@unique([userId, provider])` — но при поиске свободного слота брать busy из ВСЕХ подключённых. Это уже в плане.

## DoD (для F1-F2)

- [ ] Я.Календарь: подключение → событие туда-сюда за ≤10 мин (polling)
- [ ] Google Calendar: подключение → событие туда мгновенно (webhook), обратно мгновенно
- [ ] Conflict-резолюция работает (тестовый сценарий: одновременная правка)
- [ ] Refresh-token cron работает (Google watch channel renewal)
- [ ] Метрики prom-client + страница /me/settings/calendars/sync-log
- [ ] typecheck backend + frontend: 0 ошибок
- [ ] Integration-тесты на каждый провайдер (mock CalDAV server, mock Google)
- [ ] Документация пользователя «Как подключить Я.Календарь / Google Calendar» (RU)

## NOT-DO

- Не делаем плагин внутрь Я.Трекера/Битрикса (это другой продукт, неверный paradigm).
- Не делаем 2-way с задачами трекеров (только pull задач → наш `kind=deadline`).
- Не делаем Apple iCloud отдельно (покрывается CalDAV-провайдером бесплатно).
- Не делаем Shtab / MyOffice / ПланФикс (мало пользователей, скудное API).
