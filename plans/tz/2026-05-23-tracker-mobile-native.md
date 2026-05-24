---
type: tz
status: draft
feature: Z/Кора — нативное мобильное приложение iPhone + Android (React Native, отдельная команда параллельно)
date: 2026-05-23
parent: plans/analysis/2026-05-23-tracker-as-entry-wedge.md
related:
  - plans/tz/2026-05-23-tracker-phase-1-models-api.md
  - plans/tz/2026-05-23-tracker-phase-2-frontend-mobile-first.md
revision: 2026-05-24 — НЕ начат, ждёт RN-команды и Apple/Google/RuStore аккаунтов
---

# Нативное мобильное приложение Z/Кора

## TL;DR

Отдельный поток разработки. **React Native + Expo** для скорости и быстрых OTA-обновлений. Использует тот же REST API + WebSocket, что и web. Срок: 10-12 человеко-недель, **отдельная команда из 1-2 разработчиков параллельно** с web. Версия v1: push-уведомления с быстрым ответом, фото-к-задаче с камеры, оффлайн-чтение, голосовой ввод. Версия v2 (после): сканер QR, геолокация, полный оффлайн-write.

## Зачем

- Браузерная мобилка (PWA) не покрывает не-офисный ICP (монтажники, выездные мастера, складские, доставка).
- В РФ-обзорах нативная мобилка — **must-have для SMB**. YouGile / WEEEK / Kaiten / Битрикс24 — все нативные.
- Без мобилки теряем половину SMB-сегмента.

## Стек

- **React Native + Expo SDK 51+** — наш стек ближе (TS + React), JS-разработчики смогут.
- **Expo Router** — навигация (file-based, как Next.js App Router — знакомо).
- **TanStack Query** — data fetching + offline cache.
- **NativeWind** — Tailwind для React Native.
- **expo-notifications** — push-уведомления через FCM (Android) + APNs (iOS).
- **expo-image** — оптимизированные изображения.
- **expo-camera + expo-image-picker** — фото-к-задаче.
- **expo-audio + expo-speech-recognition** — голос.
- **expo-secure-store** — JWT токены.
- **react-native-mmkv** — быстрое локальное хранилище для оффлайн-кэша.
- **Sentry-expo** — мониторинг ошибок.

**Выбор Expo vs bare React Native:** Expo, потому что:
- Быстрый старт (Managed Workflow)
- EAS Build (publish без Mac для iOS)
- OTA-обновления (Expo Updates) — критично для быстрых фиксов без store review
- Большая часть Expo SDK покрывает наши потребности
- Если упрёмся в bare-функцию (редкий случай) — переключение на bare workflow возможно

## Архитектура

### Структура проекта

Отдельный репозиторий `kora-mobile/` (не в нашем монорепо frontend/, чтобы не смешивать стэки):

```
kora-mobile/
  app/                       # Expo Router
    (auth)/
      login.tsx
    (tabs)/
      _layout.tsx            # Bottom tabs
      inbox.tsx              # Мой инбокс
      projects.tsx
      feed.tsx
      check-in.tsx
      profile.tsx
    issue/
      [id].tsx               # Страница задачи
    meeting/
      [id].tsx               # Видеовстреча (LiveKit RN SDK)
  src/
    api/
      apiClient.ts           # axios + interceptor
      issues.api.ts
      ...
    domain/
      issue.ts
    components/
      IssueCard.tsx
      IssueChat.tsx
      VoiceRecorder.tsx
      CameraButton.tsx
    hooks/
      useIssues.ts
      useOfflineCache.ts
      usePushNotifications.ts
    contexts/
      AuthContext.tsx
      OfflineContext.tsx
  app.config.ts
  eas.json
  package.json
```

### Auth

- JWT через тот же `/api/v1/auth/login`.
- Хранение в `expo-secure-store`.
- Refresh через тот же flow что в web.

### Realtime

- WebSocket с тем же `/ws` endpoint через `socket.io-client` (если используется) или native WebSocket.
- При foreground — live updates.
- При background — push-уведомления через FCM/APNs.

## V1 — что входит в первый релиз

### 1. Push-уведомления с быстрым ответом

- При новой задаче / упоминании / probe-вопросе — push с **inline-actions** (в шторке iOS / Android):
  - «Принял» — без открытия приложения
  - «Отложить» — выбор +1 день / +3 дня
  - «Ответить голосом» (для probe-вопроса) — открыть запись прямо из шторки

### 2. Фото-к-задаче с камеры

- На странице задачи — большая кнопка «📷 Камера».
- Открывается `expo-camera`.
- Снял → загружается на бэк как `IssueAttachment` через `/api/v1/issues/:id/attachments` (multipart upload).
- Опц. при загрузке — добавление подписи / привязка к этапу.

### 3. Оффлайн-чтение

- При логине — загрузка топ-50 задач пользователя в `react-native-mmkv` cache.
- При отсутствии сети — открываются из кэша, доступно чтение + чат-история.
- Создание задачи / комментариев — невозможно в v1 (queue → v2).

### 4. Голосовой ввод

- На каждой текстовой форме (поле title, поле комментария) — кнопка «🎤».
- Tap → запись через `expo-audio`.
- Отпустил → загрузка на бэк → ASR (Vox/GigaAM) → возвращается текст → подставляется в форму.
- Опц.: голосовое сообщение в чате задачи (как в Telegram) — записал, отправил голос напрямую как `IssueComment.voiceUrl`.

### 5. Видеовстреча из задачи

- LiveKit React Native SDK (`@livekit/react-native`).
- Та же логика что в web: тап «Видеовстреча» → создаётся Meeting → открывается RN компонент с комнатой.

### 6. Утренний / вечерний чек-ин

- Push в 9:00 (утренний) / 18:00 (вечерний) с deep-link «Сделать чек-ин».
- Открывается экран чек-ина: одно поле (текст или голос) + emoji для настроения.
- Отправка одним тапом.

## V2 (после v1, отдельный этап ~4-6 нед)

- Сканер QR-кодов (для складов: «отсканировал коробку → создал задачу «Принять»)
- Геолокация в комментариях (для выездных: «был на адресе, координаты»)
- Полный оффлайн-write (создание задач/комментариев в очередь, sync при появлении сети)
- Виджеты на главном экране iOS / Android (1 задача дня)
- Apple Watch / Wear OS компаньоны (опц.)
- Siri Shortcuts / Google Assistant (опц., «эй Сири, создай задачу...»)

## Связь с web

- **Один и тот же backend.**
- **Один и тот же дизайн-язык** (mint + dark + типографика Geist) — но адаптирован под мобильные паттерны.
- **Один и тот же словарь терминов** (русский).

## Команда

- **1 RN-разработчик** ведущий (TS, опыт Expo).
- **1 RN-разработчик** junior/middle (помощник на UI + тесты).
- **Дизайнер на 0.2** для адаптаций под iOS/Android паттерны.
- **0.3 backend** на корректировки API для мобилки (если потребуется).

## Релизный цикл

- EAS Build → submit в App Store / Google Play раз в 2 недели.
- OTA (Expo Updates) — горячие фиксы без store review (для JS-only изменений).

## DoD v1

- [ ] Логин + JWT auth
- [ ] Bottom navigation с 5 табами
- [ ] Список задач (мой инбокс) с offline-cache
- [ ] Страница задачи с чатом + камера + голос
- [ ] Утренний/вечерний чек-ин с голосом
- [ ] Push-уведомления с inline actions
- [ ] Видеовстреча из задачи (LiveKit RN SDK)
- [ ] AI-парсинг голоса для создания задачи
- [ ] Лента активности (упрощённая)
- [ ] Все строки на русском
- [ ] Submit + approve в App Store + Google Play
- [ ] OTA-обновления работают
- [ ] Sentry мониторинг
- [ ] E2E-тесты ключевых flow на Detox или Maestro

## Срок

**10-12 человеко-недель** (отдельная команда, **параллельно** с веб-разработкой, не блокирует её).

## Открытые решения

- **Аналитика:** Amplitude / PostHog / своя? Я предлагаю — **PostHog** (есть self-host, наш стек).
- **Crash reporting:** Sentry-expo — да.
- **Магазины:** App Store + Google Play. **RuStore** — желательно для РФ (после iOS из РФ периодически удаляют). Заложить.
- **Локализация в магазинах:** русский + английский описания.

## Метрики

Backend (новые):
```
mobile_app_active_users_daily{platform}
mobile_app_active_users_monthly{platform}
mobile_push_delivered_total{platform}
mobile_push_action_total{platform, action_type}
mobile_camera_uploads_total{tenant}
mobile_voice_inputs_total{tenant}
```

---

_2026-05-23: нативная мобилка как отдельный поток. v1 покрывает не-офисный ICP — монтажники, выездные, складские._

## Ревизия от 2026-05-24

**Статус:** draft
**Реализовано:** Ничего. Поиск показал отсутствие папок `kora-mobile/`, `mobile/`, отсутствие зависимостей `expo`/`react-native`/`@livekit/react-native` в проекте. Не настроены EAS, не зарегистрированы Apple Developer / Google Play / RuStore аккаунты.

**Осталось:** Весь scope ТЗ. Не блокируется техническими зависимостями — все нужные backend API (REST + WebSocket + auth + LiveKit JWT) готовы из Wave 1-3, можно стартовать как только владелец подтвердит выделение RN-команды (1 lead + 1 junior + 0.2 дизайн + 0.3 backend на корректировки API) и счета магазинов.
