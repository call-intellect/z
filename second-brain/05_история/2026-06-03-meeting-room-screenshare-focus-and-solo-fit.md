---
date: 2026-06-03
title: Комната встречи — фокус-раскладка для демонстрации экрана + contain для соло-видео
tags: [meeting-room, livekit, frontend, ux-fix]
distilled: false
---

# Комната встречи: демонстрация экрана на главной сцене + соло-видео без обрезки

## Что было поставлено
Пользователь тестировал живую встречу (`meet.crossmark.ru`) и нашёл два дефекта:
1. **Видео «на весь экран» выглядит растянутым/обрезанным**, а в сетке из 4 тайлов — нормально.
2. **Демонстрация экрана подключается «четвёртым участником»** — обычной плиткой в сетке, а не на весь экран, как привычно в Zoom/Meet/Teams.

## Как решал
Корень обоих — в `frontend/src/ui/components/meeting-room/MeetingRoom.tsx`, функция `VideoArea`:
она клала **камеры и демонстрацию экрана в один плоский `GridLayout`** и не имела фокус-логики.

Прочитал исходники LiveKit (не по интуиции — по правилу «поведение фреймворка проверять по исходнику»):
- `node_modules/@livekit/components-styles/.../participant/index.css` — дефолт камеры `object-fit: cover`,
  у `screen_share` и `portrait` — уже `contain`.
- Минифицированный `shared-CJDltH4I.js` → компонент `VideoConference` (`Pt`): использует
  `useCreateLayoutContext` + `usePinnedTracks`, авто-пин screen-share, рендер через
  `FocusLayoutContainer` (карусель + `FocusLayout`) либо `GridLayout`.

Повторил этот канон в `VideoArea`:
- `LayoutContextProvider` + `useCreateLayoutContext` + `usePinnedTracks`.
- `useEffect` авто-закрепляет screen-share на главной сцене и снимает фокус, когда демонстрация уходит
  (ключ зависимости вынес в `screenShareSignature`, иначе eslint ругается на сложное выражение в deps).
- `FocusLayoutContainer` → `CarouselLayout` (участники сбоку) + `FocusLayout` (демонстрация).
- `isEqualTrackRef` из `@livekit/components-core` НЕ тянул (не в публичном API react-пакета) —
  написал локальный `isSameTrack` (сравнение по `trackSid`, иначе по `identity`+`source`).

Для соло-видео (#1): класс `kora-video-solo` на `GridLayout` при `tracks.length === 1` +
правило в `frontend/app/globals.css`:
`.kora-video-solo .lk-participant-media-video[data-lk-source='camera'] { object-fit: contain; }`.
Специфичность (0,3,0) перебивает дефолт LiveKit (0,2,0) — важно, т.к. `globals.css`
импортируется ДО `@livekit/components-styles`, и при равной специфичности победил бы LiveKit.

## Что вышло
- `bun run typecheck` — чисто; `bun run lint` — чисто (после выноса deps-ключа); `bun run build` — успешно.
- Поведение видно только в реальной встрече (LiveKit + ≥2 участника / демонстрация) — отметил
  пользователю шаги ручной проверки.
- Коммит `c50112da` (fix(meeting-room): ...), запушен в `feature/goals-okr-v2`.
- Бонус: с появлением `LayoutContextProvider` заработала штатная кнопка ручного фокуса на тайле.

## Чему научился
- **Прежде чем городить свою раскладку — посмотри, как это делает прелб библиотеки.** `VideoConference`
  из `@livekit/components-react` уже решает и авто-фокус демонстрации, и фокус-раскладку; мы не могли
  взять его целиком (свои header/controls/панели), но скопировали именно логику `VideoArea`.
- **`object-fit: cover` не растягивает — он обрезает.** То, что пользователь называет «растянуто»,
  на ультравайде = агрессивный кроп одиночного тайла. Лечение — `contain` для соло/фокуса.
- **Порядок импорта CSS решает при равной специфичности.** `globals.css` идёт до стилей LiveKit,
  поэтому override обязан иметь специфичность строго выше — добавил атрибутный селектор.
- Подтвердил ловушку: транзитивные утилиты (`isEqualTrackRef`) из `@livekit/components-core` не
  реэкспортятся react-пакетом — проще написать локальный аналог, чем тянуть транзитивную зависимость.
