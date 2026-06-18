---
type: tz
status: ready-to-implement
feature: meeting-room-three-bugs-fix
date: 2026-06-17
owner: Сергей (sergrv80@gmail.com)
relates_to: [plans/tz/2026-06-17-meeting-review-and-journal-redesign.md]
---
> Анализ: встроен ниже (REALITY-CHECK + Доказательство выбора), отдельного файла в `plans/analysis/` нет — разбор лёгкий. · Статус согласования: 2026-06-17

# Фикс трёх багов живой видеовстречи: чат, обрезка камеры, мутный экран

## Цель
Починить три независимых бага в **живой комнате** встречи (`frontend/src/ui/components/meeting-room/`), которые ломают базовый сценарий звонка:
1. Текстовый чат во время встречи не доставляет сообщения другим участникам.
2. При ≥2 участниках в сетке камера обрезает кадр (срезает голову / «узкое» видео).
3. При демонстрации экрана текст у получателей расплывчатый.

## Зачем (болезненное состояние)
- Чат участников фактически нерабочий: автор видит своё сообщение (оптимистично), остальные — нет; история подтянется только при следующем входе. Канал внутри встречи мёртв.
- Сетка 2×2 при 4 участниках режет лица — встреча выглядит непрофессионально, владелец жалуется на это повторно.
- Демонстрация экрана с текстом/таблицами нечитаема у зрителей — обесценивает экранный шеринг как инструмент.

Все три — **чисто клиентские** (frontend), без изменений backend, БД, ENV, очередей. LiveKit остаётся «только медиа» (CLAUDE.md принцип 3) — токены и permissions не трогаем.

## REALITY-CHECK (факт по коду на 2026-06-17)
> Номера строк — на момент написания; **перед правкой перечитать файл** и искать по якорю-символу (LiveKit-вёрстка/строки дрейфуют).

- **Чат.** UI кастомный (`ChatPanel.tsx`), но live-доставка идёт через встроенный `useChat()` из `@livekit/components-react`. Отправка форсит **уникальный topic** `chat-<clientMessageId>` (`ChatPanel.tsx:204-206`, константа `TOPIC_PREFIX='chat-'` на `:39`). Приёмник `useChat()` регистрирует text-stream-обработчик только на дефолтном топике `lk.chat` (внутри `@livekit/components-core` `setupChat`: `options.topic ??= 'lk.chat'`, обработчик на `lk.chat`). Топики не совпадают → входящие стримы не матчатся → `chatMessages` у других участников пуст. Токен НЕ виноват: `backend/src/modules/livekit/livekit.service.ts:74-83` выдаёт `canPublishData: true` всем.
- **Обрезка камеры.** Сетка — `GridLayout`+`ParticipantTile` из `@livekit/components-react` (`MeetingRoom.tsx:275-282`). Дефолтный CSS LiveKit ставит видео `object-fit: cover` (обрезка под форму ячейки). Проектный фикс `object-fit: contain` навешан **только на `.kora-video-solo`** (один участник, `globals.css:31-33`), который применяется лишь при `tracks.length === 1` (`MeetingRoom.tsx:261,278`). При ≥2 участниках класса нет → дефолтный `cover` режет кадр.
- **Мутный экран.** Кнопка экрана — `<TrackToggle source={Track.Source.ScreenShare}>` (`ControlsBar.tsx:126-137`) **без** `captureOptions`/`publishOptions` → публикация на дефолтах `livekit-client`: нет `contentHint` (кодек оптимизирует под движение, мылит текст), `screenShareEncoding=h1080fps15` (потолок ~2.5 Мбит/с). Подтверждено по исходнику: `@livekit/components-react` `TrackToggle` принимает пропсы `captureOptions?: CaptureOptionsBySource<T>` и `publishOptions?: TrackPublishOptions` (`dist/components/controls/TrackToggle.d.ts:14-15`), а `ScreenShareCaptureOptions` (livekit-client) содержит поле `contentHint`. Серверный конфиг (`infra/livekit/*.yaml`) лимитов битрейта не ставит — проблема не на сервере.
- Существующего флага/обёртки для этих правок нет. Параллельных сессий по `meeting-room` в `git log --since=1day` нет.

## Принятые решения владельца
| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р1 | Багфиксы выкатываются **включёнными, без флага** | Ship-On (CLAUDE.md принцип 8); это фронтовые правки, откат — раскаткой; флаг «на всякий» запрещён | 2026-06-17 |
| Р2 | Обрезку лечим `object-fit: contain` (кадр целиком, допустимы тёмные поля), НЕ через cover+16:9-тайл | Приоритет владельца «не резать голову»; переиспользуем уже работающий solo-паттерн → минимальный риск (challenge-loop: «проще/дешевле», «переиспользование») | 2026-06-17 |
| Р3 | Мутность лечим `contentHint:'detail'` + поднятие `screenShareEncoding`; **simulcast НЕ отключаем** | `contentHint` — корень мыла, влияет на все simulcast-слои; отключение нижнего слоя ударило бы по слабым каналам (стопкадры). Отключение simulcast — НЕ делаем (см. Вне scope) | 2026-06-17 |

## Доказательство выбора (по каждому багу)

**Баг 1 (чат).** Проход A: убрать кастомный `topic` из `send(...)` — дефолт `lk.chat` совпадёт с обработчиком. Проход B (иная ось — точка интеграции): полностью отказаться от `useChat()` и слать своё через `room.localParticipant.publishData` + свой топик/обработчик.

| Критерий | A: убрать topic | B: свой publishData-канал |
|---|---|---|
| Объём правки | 1 строка + удалить мёртвую константу | новый канал приём/отправка, парсинг, дедуп — десятки строк |
| Риск регресса | минимальный (возврат к штатному поведению либы) | высокий (свой протокол поверх DataChannel) |
| Дедуп дублей | уже работает через `attributes.clientMessageId` (`extractClientId` `:54-60`) | нужно переписать |
| Совместимость с историей backend | не трогается | не трогается |

→ **A**. Challenge-loop: решает корень (несовпадение топика), не симптом; самое дешёвое; B — код ради кода.

**Баг 2 (обрезка).** Проход A: расширить `object-fit: contain` на сетку (не только solo). Проход B (иная ось — модель раскладки): задать тайлам фиксированное `aspect-ratio: 16/9` и центрировать сетку, оставив `cover` (тогда форма ячейки = форма кадра, обрезки нет, полей нет).

| Критерий | A: contain на сетке | B: 16:9-тайлы + cover |
|---|---|---|
| Голова не срезается | да | да |
| Тёмные поля | да (вокруг кадра в ячейке) | нет |
| Риск сломать высоту грида LiveKit (`grid-auto-rows:1fr`) | нет | средний (фикс. aspect конфликтует с `1fr`) |
| Переиспользование готового паттерна | да (`.kora-video-solo` уже так делает) | нет, новый CSS |

→ **A** (Р2). B красивее (без полей), но рискует раскладкой и не переиспользует готовое; вынесен в «Вне scope / vNext».

**Баг 3 (мутность).** Проход A: задать `captureOptions={{contentHint:'detail'}}` + `publishOptions={{screenShareEncoding: ScreenSharePresets.h1080fps30.encoding}}` на самом `<TrackToggle>` экрана. Проход B (иная ось — точка конфигурации): прокинуть глобальные `options.publishDefaults` в `<LiveKitRoom>`.

| Критерий | A: на TrackToggle | B: publishDefaults у LiveKitRoom |
|---|---|---|
| `contentHint` (главный рычаг) | ставится на capture экрана напрямую | publishDefaults НЕ несёт contentHint (он на capture-track) → пришлось бы всё равно трогать toggle |
| Локальность изменения | только кнопка экрана | глобально, риск задеть камеру/симулькаст всех |
| Объём | 1 проп-блок | RoomOptions + риск регресса камеры |

→ **A**. Challenge-loop: `contentHint` — корень (LiveKit по умолчанию `maintain-framerate`, жертвует чёткостью); битрейт — усиление; simulcast не трогаем (Р3), чтобы не уронить слабые каналы.

## Scope
**Входит:**
- Ф1: чат доставляет сообщения live между участниками.
- Ф2: камера в сетке (≥2 уч.) не обрезает кадр.
- Ф3: демонстрация экрана читаема (чёткий текст у зрителей).

**Не входит (vNext / отдельные ТЗ):**
- Замена сетки на 16:9-тайлы без полей (вариант B бага 2) — отдельная UX-задача, если тёмные поля не устроят.
- Кодеки VP9/AV1 для экрана (лучше текста при той же полосе) — требует включения кодека на сервере `infra/livekit/*.yaml` + проверки совместимости. Отдельное ТЗ.
- Вынос порогов битрейта/`contentHint` в `AdminSetting` (крутилка super_admin) — vNext, если ops захотят регулировать полосу без релиза (`feedback_admin_settings_not_env_or_code`). Пока — константа в коде (code-fallback).
- Любой backend / токены / ENV / БД.

## Граничные контракты
- Backend `livekit.service.ts` (генерация токена, permissions) — **не трогаем**, считаем корректным (`canPublishData: true` уже есть).
- Серверный конфиг `infra/livekit/*.yaml` — **не трогаем**.
- ТЗ редизайна (`relates_to`) работает с `meeting-result-v2/` и журналом — **не пересекается по файлам** с этим ТЗ (`meeting-room/`). Можно реализовывать параллельно.

## Границы автономии
- ✅ Always: правки внутри `meeting-room/*` и `globals.css`; re-Read файла перед Edit; `typecheck`/`lint`/`build` после каждой фазы.
- ⚠️ Ask first: любое изменение токена/permissions, серверного конфига LiveKit, отключение simulcast, смена кодека.
- 🚫 Never: `git add .`/`-A`; правка backend; ввод feature-флага «на всякий случай»; `process.env.*`.

---

## Фаза 1 — Чат доставляет сообщения live
**Закрывает:** R1.

**Файлы:** `frontend/src/ui/components/meeting-room/ChatPanel.tsx`.

**Картография:**
- `:38-39` — JSDoc-комментарий + `const TOPIC_PREFIX = 'chat-';` (станет мёртвым после правки).
- `:203-209` — вызов `send(text, { topic: TOPIC_PREFIX + clientMessageId, attributes: {...} })`.
- `:54-60` — `extractClientId` (дедуп по `attributes.clientMessageId`) — НЕ трогать.

**Что делать (R1):** убрать форсирование топика, оставить только `attributes`. Текущий блок (`:204-206`):
```ts
const livekitSend = send(text, {
  topic: TOPIC_PREFIX + clientMessageId,
  attributes: { [ATTR_CLIENT_MESSAGE_ID]: clientMessageId },
}).catch(() => {
```
→ стать:
```ts
const livekitSend = send(text, {
  attributes: { [ATTR_CLIENT_MESSAGE_ID]: clientMessageId },
}).catch(() => {
```
И удалить ставшие мёртвыми `:38-39` (JSDoc + `TOPIC_PREFIX`), иначе `lint` упадёт на unused.

**Что НЕ входит:** менять backend-историю (`roomMessagesApi`), дедуп, UI чата, токен.

**Acceptance (машинно):**
- Grep `frontend/src/ui/components/meeting-room/ChatPanel.tsx`: `topic:` внутри вызова `send(` — **0 совпадений**; `TOPIC_PREFIX` — **0 совпадений** во всём файле.
- Grep: вызов `send(text, {` присутствует и содержит `attributes`.
- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` — зелёные (из `frontend/`).
- Ручная проверка (описать в Итоге): 2 участника в комнате; участник A отправляет «тест-1» → участник B видит «тест-1» в чате live (без перезахода). Автор не видит дубля своего сообщения.

---

## Фаза 2 — Камера в сетке не обрезает кадр
**Закрывает:** R2.

**Файлы:** `frontend/app/globals.css`, `frontend/src/ui/components/meeting-room/MeetingRoom.tsx`.

**Картография:**
- `globals.css:29-33` — единственный override:
  ```css
  .kora-video-solo .lk-participant-media-video[data-lk-source='camera'] {
    object-fit: contain;
  }
  ```
- `MeetingRoom.tsx:275-282` — `GridLayout` с `className={isSolo ? 'lk-grid-layout kora-video-solo' : 'lk-grid-layout'}`.
- `MeetingRoom.tsx:261` — `const isSolo = !focusTrack && tracks.length === 1;`.

**Что делать (R2):**
1. В `MeetingRoom.tsx:278` всегда добавлять класс сетки `kora-video-grid`, сохраняя solo как дополнительный:
   ```tsx
   className={isSolo ? 'lk-grid-layout kora-video-grid kora-video-solo' : 'lk-grid-layout kora-video-grid'}
   ```
2. В `globals.css` добавить правило для сетки (рядом с solo, специфичность (0,3,0) перебивает дефолт `cover`):
   ```css
   /* LiveKit: в сетке участников показываем кадр камеры целиком (без обрезки головы).
      Допустимы тёмные поля — приоритет «не резать лицо». */
   .kora-video-grid .lk-participant-media-video[data-lk-source='camera'] {
     object-fit: contain;
   }
   ```

**Что НЕ входит:** трогать `FocusLayout`/`CarouselLayout` (демонстрация экрана / пин) — там своя раскладка с `aspect-ratio: 16/10`, жалоб нет; менять object-fit для `screen_share`; вводить 16:9-тайлы (vNext).

**Acceptance (машинно):**
- Grep `globals.css`: присутствует селектор `.kora-video-grid .lk-participant-media-video[data-lk-source='camera']` с `object-fit: contain`.
- Grep `MeetingRoom.tsx`: строка `GridLayout` className содержит `kora-video-grid` в обеих ветках (solo и не-solo).
- `typecheck`/`lint`/`build` зелёные.
- Ручная проверка: 4 участника с камерами → ни у кого голова не срезается, виден весь кадр (возможны тёмные поля по краям ячейки).

---

## Фаза 3 — Читаемая демонстрация экрана
**Закрывает:** R3.

**Файлы:** `frontend/src/ui/components/meeting-room/ControlsBar.tsx`.

**Картография:**
- `:126-137` — `<TrackToggle source={Track.Source.ScreenShare}>` (только `className` + дети, без опций публикации).
- Импорт `Track` из `livekit-client` уже есть (используется в файле). `ScreenSharePresets` — добавить в импорт.

**Что делать (R3):** добавить на `<TrackToggle>` экрана `captureOptions` и `publishOptions`:
```tsx
<TrackToggle
  source={Track.Source.ScreenShare}
  captureOptions={{ contentHint: 'detail' }}
  publishOptions={{ screenShareEncoding: ScreenSharePresets.h1080fps30.encoding }}
  className={clsx(
    'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-medium transition-colors',
    isScreenShareEnabled ? 'bg-info text-info-fg hover:opacity-90' : 'bg-bg-overlay text-fg-primary hover:bg-bg-overlay/80',
  )}
>
```
Импорт: `import { Track, ScreenSharePresets } from 'livekit-client';` (объединить с существующим импортом `Track`, не дублировать).

> Поведение проверено по исходнику (не угадано): `useTrackToggle` прокидывает `captureOptions` → `setScreenShareEnabled(enabled, captureOptions)`, который ставит `track.mediaStreamTrack.contentHint = 'detail'` (`LocalParticipant.ts:746-748`); `publishOptions.screenShareEncoding` задаёт битрейт публикации. `ScreenSharePresets.h1080fps30.encoding` = 1920×1080@30, потолок ~5 Мбит/с (vs дефолт `h1080fps15` ~2.5 Мбит/с). `degradationPreference` для экрана библиотека сама держит `maintain-resolution` — явно не задаём.

**Что НЕ входит:** отключать simulcast (`screenShareSimulcastLayers`/`simulcast:false`) — Р3; менять `<LiveKitRoom>` options; трогать камеру/микрофон toggles; кодеки.

**Acceptance (машинно):**
- Grep `ControlsBar.tsx`: у `TrackToggle` с `source={Track.Source.ScreenShare}` присутствует `captureOptions={{ contentHint: 'detail' }}` и `publishOptions={{ screenShareEncoding: ScreenSharePresets.h1080fps30.encoding }}`.
- Grep: `import { ... ScreenSharePresets ... } from 'livekit-client'`.
- `typecheck`/`lint`/`build` зелёные (тип `contentHint` принимает `'detail'`; если TS ругнётся на тип — взять литерал из `ScreenShareCaptureOptions`).
- Ручная проверка: участник демонстрирует экран с мелким текстом (например, документ) → у другого участника текст читаем/резкий (не размыт). Сравнить «до/после» скриншотом у зрителя.

---

## Риски / Pre-mortem (для strict-production-review-gate)
- **Ф1:** если на сервере LiveKit стоит старая версия без text-stream — дефолтный `lk.chat` может пойти legacy-путём; на современном сервере (наш) text-stream работает. Если в проде чат всё равно молчит — проверить версию LiveKit-сервера и `serverSupportsDataStreams()`. Ревью: убедиться, что `attributes`-дедуп не сломан (свой текст не задваивается).
- **Ф2:** `object-fit: contain` даёт тёмные поля — это ожидаемо (Р2). Проверить, что solo-режим не сломался (двойной класс `kora-video-solo kora-video-grid` — оба правила идентичны, конфликта нет). Проверить демонстрацию экрана (focus-раскладка) — её не задели.
- **Ф3:** рост битрейта до ~5 Мбит/с увеличивает исходящую полосу демонстрирующего. На очень слабом аплинке возможны просадки fps экрана (но `maintain-resolution` сохранит чёткость). Если в проде жалобы на полосу — снизить пресет или вынести в `AdminSetting` (vNext). Проверить, что `contentHint` не сломал случай «демонстрация видео/анимации» (для видео `detail` менее оптимален, но текст — приоритет владельца).
- Регресс-зона у всех трёх — только `meeting-room/`. E2E живой комнаты в репо нет — приёмка ручная (минимум 2 участника).

## Feature-flag / idempotency / prod-deploy
- **Флагов нет** (Р1, Ship-On). Строка в `docs/operations/feature-flags.md` не требуется.
- Идемпотентность не применима (нет seed/patch/migrate/backfill).
- **Prod-deploy:** только пересборка фронтенда (`docker compose up -d --build` фронт-образа). Миграций/ENV/скриптов/очередей **нет** → новых шагов в `docs/operations/prod-deploy-log.md` не добавляется.

## DoD
- [ ] Ф1–Ф3 реализованы, каждая фаза: re-Read перед Edit, `git status` чист от чужих файлов.
- [ ] `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` из `frontend/` — зелёные.
- [ ] Ручная приёмка всех трёх багов задокументирована в Итоге (с участниками/скриншотами).
- [ ] `second-brain/01_projects/` — при необходимости отметка о фиксе живой комнаты (профильная заметка о встречах), если ведётся.
- [ ] Рефлексия в `second-brain/05_история/` после push; prod-инструкция в чате (ожидается «prod-операций нет, достаточно rebuild фронта»).
- [ ] Коммиты по фазам: `fix(meeting-room): ...`.

## Итог
**Статус: реализовано целиком (3/3 фазы), приёмка зелёная, ожидает живой комнаты для ручной верификации.** Сессия 2026-06-18, ветка `feature/meeting-fixes-and-result-redesign`.

| Фаза | Что сделано | Коммит | Машинная приёмка |
|---|---|---|---|
| Ф1 чат | Убран форс `topic` в `send()` + мёртвый `TOPIC_PREFIX` (`ChatPanel.tsx`); дедуп по `attributes.clientMessageId` сохранён | `39f17355` | `TOPIC_PREFIX`/`topic:` → 0; typecheck/lint/build ✅ |
| Ф2 камера | `kora-video-grid` в обе ветки `GridLayout` + правило `object-fit: contain` в `globals.css` | `2b9287a0` | `kora-video-grid` ×2 + селектор в css; ✅ |
| Ф3 экран | `captureOptions={{contentHint:'detail'}}` + `publishOptions.screenShareEncoding=ScreenSharePresets.h1080fps30` на ScreenShare-`TrackToggle` (`ControlsBar.tsx`) | `280825d8` | импорт + оба пропса; типы livekit-client@2.19 проверены по `.d.ts`; ✅ |

**Верификация:** typecheck (вкл. `.spec`) / lint (0 errors) / build — зелёные после каждой фазы. Независимое production-ревью диффа: 🔴 0 критичных; Ф1 подтверждён как реальный фикс (по исходнику `@livekit/components-core` приёмник слушает только `lk.chat`). Доказательство выбора типов и контрактов — по `node_modules/.d.ts` (не угадано).

**Осталось (не блокирует выкат):** ручная приёмка в живой комнате на 2+ участниках (чат live, отсутствие обрезки при 4 камерах, резкость текста при шаринге) — E2E живой комнаты в репо нет, приёмка ручная по факту выката. Вынесено в vNext (см. «Не входит»): 16:9-тайлы без полей (вариант B бага 2), кодеки VP9/AV1 для экрана, вынос порогов битрейта/`contentHint` в `AdminSetting`.

**Prod:** операций нет (frontend-only), выкат = rebuild фронта.
