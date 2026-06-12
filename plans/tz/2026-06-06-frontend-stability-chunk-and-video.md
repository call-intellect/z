---
type: tz
status: ready-to-implement
feature: frontend-stability-chunk-and-video
date: 2026-06-06
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-06-handoff-brief-all-prod-fixes.md
  - plans/analysis/2026-06-06-deep-root-cause-analysis-prod-issues.md
  - plans/analysis/2026-06-06-retest-RESULTS-technical.md
---

> Анализ-источник: `deep-root-cause-analysis-prod-issues.md` §0 (кросс-вывод), §3 (C), §4 (D), §10 (эмпирический тест видео) · бриф §ТЗ-1 · Статус согласования: решения decisive (бриф), ожидает запуска реализации.
> Цель в одну строку: убрать «белый экран» ChunkLoadError на детальных страницах и оживить видео записи — **переводом prod-сборки на webpack, включением `deploymentId` и заменой Vidstack-плеера на нативный `<video>`** (доказано эмпирически на проде, §10).

---

## 1. Цель и зачем (человеческим языком)

**Что не так сейчас (две жалобы владельца, один корень).**
1. **«Тормоза/задержки при переходах»** — детальные страницы периодически падают в английский экран **«This page couldn't load»**. Стабильно `/tables/[id]`, иногда `/result`, `/structure/persons/[id]`. Это `ChunkLoadError: Failed to load chunk … from module 964893` при том, что прямой запрос файла чанка → **HTTP 200**: рассогласование реестра модулей рантайма и содержимого чанка.
2. **Видео записи не проигрывается** — вечная крутилка вместо плеера.

**Корень (доказан, общий — Turbopack в prod-сборке).** `next build` в Next 16 по умолчанию идёт **Turbopack** (флага нет — [package.json:8](../../frontend/package.json#L8) `"build":"next build"`, [package.json:54](../../frontend/package.json#L54) `next ^16.2.6`), а `deploymentId` не задан ([next.config.mjs](../../frontend/next.config.mjs) — нет ключа). Итог: (а) при неатомарной замене статики для уже открытых вкладок старый HTML делает `import()` чанка, чей реестр не совпадает с новым билдом → ChunkLoadError; (б) та же сборка не подгружает чанк регистрации web-компонента Vidstack → `<media-player>` не «оживает», внутренний `<video>` остаётся пустым (`src=""`, networkState=0). Видео-фикс `8fab2fc2` (`load="eager"`) **на проде есть, но бессилен** — это рантайм-проблема инициализации Vidstack, а не отсутствие фикса.

**Доказательство решающее (прод, Playwright, §10 анализа).** В живую страницу прода вставлен нативный `<video src={presignedUrl}>` → **играет**: `readyState:4 (HAVE_ENOUGH_DATA), networkState:2, duration:90.6с, 1280×720, played:true, error:null`. Значит файл/кодек/CSP/presigned-URL **исправны**; сломан ТОЛЬКО Vidstack (не инициализируется). Нативный `<video>` — гарантированный путь.

**Чем решение лучше.** (1) `next build --webpack` — проверенное годами поведение чанков, снимает Turbopack-prod рассогласование; (2) `deploymentId` включает штатную Next-защиту от version skew (hard MPA-navigation при несовпадении билда); (3) нативный `<video>` гарантированно играет (тест доказал) и убирает целый класс рисков (tree-shaking регистрации web-компонента, апгрейды Next/React); (4) русский экран ошибки + тихий авто-reload вместо английского «This page couldn't load». Делаем И webpack, И нативный `<video>` — чтобы стабильность не зависела от того, оживит ли webpack именно Vidstack (бриф §ТЗ-1, решение).

---

## 2. REALITY-CHECK (что по факту в коде на момент написания)

| Проверено | Факт | Источник |
|---|---|---|
| Сборка идёт Turbopack'ом | `"build":"next build"` — флага `--webpack` нет; Next 16 → Turbopack по умолчанию | [package.json:8](../../frontend/package.json#L8); Context7 Next 16 upgrade guide |
| `deploymentId` / `generateBuildId` | **Нет** ни того, ни другого в `next.config.mjs` → version-skew защита выключена | [next.config.mjs:65-84](../../frontend/next.config.mjs#L65-L84) |
| `error.tsx` / `global-error.tsx` | **Нет ни одного** во `frontend/app/**` → дефолтный английский экран ошибки | glob `app/**/{error,global-error}.tsx` = пусто |
| Места Vidstack `<MediaPlayer>` (весь КЛАСС) | **Ровно 3:** [MeetingPlayer.tsx:85](../../frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx#L85), [ShareMeetingClient.tsx:131](../../frontend/app/share/[token]/ShareMeetingClient.tsx#L131), [ShareClipClient.tsx:106](../../frontend/app/share/clip/[token]/ShareClipClient.tsx#L106). Плюс хук [use-vidstack-player.ts](../../frontend/src/hooks/use-vidstack-player.ts) (тип `MediaPlayerInstance`) | grep `<MediaPlayer\|from '@vidstack/react'` |
| Интеграция плеера (seek/markers) | `useVidstackPlayer()` → `playerRef` + `seekTo(ms)` (`p.currentTime = ms/1000`); в [MeetingResultPageReal.tsx](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx): `:175` создание, `:221` `player.seekTo(ms)` по клику на главу, `:281-286` `<MeetingPlayer playerRef={player.playerRef}>` | [use-vidstack-player.ts:11-39](../../frontend/src/hooks/use-vidstack-player.ts#L11-L39) |
| Прецедент нативного медиа | Нативный `<audio>` с `el.currentTime = sec` уже работает в том же файле | [MeetingResultPageReal.tsx:1267](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L1267), [:1314](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L1314) |
| CSP для видео | `media-src 'self' blob: https:` — presigned S3 (`https:`) уже разрешён, менять CSP НЕ нужно | [next.config.mjs:35](../../frontend/next.config.mjs#L35) |
| Маркеры глав/хайлайтов | `PlayerMarkers` — absolute-оверлей над таймлайном Vidstack (`bottom-[60px]`) | [MeetingPlayer.tsx:122-162](../../frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx#L122-L162) |
| Сборка / build-args | `bun run build` в стадии builder; build-args только `NEXT_PUBLIC_*`; `output:'standalone'`, copy-to-host | [Dockerfile:27-45](../../frontend/Dockerfile#L27-L45) |
| nginx-кэш статики | `/_next/static/` → `Cache-Control: public, max-age=31536000, immutable` (удлиняет жизнь старого манифеста; `deploymentId` это покрывает) | [z-frontend.conf:58-63](../../deploy/nginx/z-frontend.conf#L58-L63) |
| 1 фронт-реплика | Multi-replica skew исключён; рассинхрон только во времени (старая вкладка vs новый билд) | [docker-compose.yml] frontend single |
| Параллельные сессии | git log 2 дня: видео/chunk параллельной работой **не затронуты** (sergdev — трекер/встречи/reliability, не плеер) | `git log --since=2d` |

**Следствие для дизайна:** правки фронтовые, контейнерные, бэкенд не трогаем; 3 места плеера + хук — закрытый список (whole-class); нативный `<audio>` уже доказал паттерн; CSP не меняется. Это делает замену низкорисковой.

---

## 3. Доказательство выбора (два прохода + challenge-loop)

**Проход A (выбран).** webpack + `deploymentId` + русский error-boundary с авто-reload + нативный `<video>` во всех 3 местах.
**Проход B (альтернатива).** Остаться на Turbopack, лечить только `deploymentId` + ChunkLoadError-reload; Vidstack оставить, пытаясь «оживить» явным импортом регистрации web-компонента.

| Критерий (= ограничение фичи) | A: webpack + native video | B: Turbopack + deploymentId + спасать Vidstack |
|---|---|---|
| Чинит ChunkLoadError | ✅ webpack — проверенное поведение чанков | ⚠️ только `deploymentId` маскирует skew, но Turbopack-prod кварка остаётся |
| Чинит видео | ✅ нативный `<video>` доказан тестом (§10) | ✗ зависит от того, оживёт ли регистрация Vidstack под Turbopack/standalone — недоказуемо |
| Зависит от runtime-кварки Turbopack | ✅ нет (ушли на webpack) | ✗ да |
| UX-плеера | ⚠️ нативные контролы вместо mint-скина Vidstack (минимальный ущерб) | ✅ сохраняет скин Vidstack |
| Класс рисков (tree-shaking регистрации, апгрейды Next/React) | ✅ снят | ✗ остаётся |
| Объём правок | M (3 файла плеера + хук + build) | S, но недоказуемый результат |

**Вывод.** A выигрывает по «чинит наверняка» (тест доказал нативный `<video>`; webpack — проверенное поведение). Минус A — потеря кастомного скина плеера — осознанный компромисс владельца (бриф §ТЗ-1, §10).

**Challenge-loop:**
- *Корень, а не симптом?* Да: webpack убирает корень рассогласования чанков для **всех** lazy-границ (не только `/tables/[id]`); нативный `<video>` убирает корень инициализации Vidstack во **всех 3** местах. Не точечная заплатка.
- *Самое эффективное?* Да: `deploymentId` + webpack — две строки конфига закрывают целый класс; нативный `<video>` переиспользует готовый паттерн `<audio>`. Не вводим blue-green/общий volume (оверкилл при 1 реплике — отвергнуто, §3 анализа вариант C).
- *Нет ли кода ради кода?* Наоборот — после замены `@vidstack/react` становится **мёртвой зависимостью** → удаляем из `package.json` и `transpilePackages` (Фаза 3), не оставляем задел.

---

## 4. Принятые решения владельца (decisive, не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р1 | **`next build --webpack`** — увести prod-сборку с Turbopack на webpack. | ChunkLoadError «from module N» при HTTP 200 — характерный класс Turbopack-prod рассогласования; webpack — проверенное поведение чанков (Context7, гайд апгрейда Next 16). |
| Р2 | **`deploymentId: process.env.DEPLOYMENT_VERSION`** (git sha, build-arg). | Штатная Next-защита от version skew: при несовпадении билда клиента и сервера — hard MPA-navigation (полная перезагрузка с ассетами нового билда). Context7-подтверждено. |
| Р3 | **Нативный `<video controls preload="auto" playsInline>` вместо Vidstack во всех 3 местах** (безусловно, не «если webpack не оживил»). | Тест §10 доказал: нативный `<video>` играет. Делаем независимо от webpack, чтобы стабильность видео не зависела от инициализации Vidstack. Потеря mint-скина — принятый минимальный UX-компромисс. |
| Р4 | **Русский `global-error.tsx` + route-group `error.tsx` + тихий однократный `location.reload()` на ChunkLoadError** (анти-цикл через `sessionStorage`). | Убрать английский «This page couldn't load»; UI Z — только русский (память `feedback_admin_ui_russian_only`); reload скрывает version-skew от пользователя, anti-loop защищает от бесконечной перезагрузки. |
| Р5 | **Маркеры глав/хайлайтов — тонкой полосой НАД нативным `<video>`** (не оверлеем точно на нативный скраббер). Клик по главе по-прежнему сикает (`videoEl.currentTime = ms/1000`). | Нативный скраббер браузера не поддаётся точному CSS-оверлею позиции. Главы и так дублируются кликабельным списком ([MeetingResultPageReal.tsx:221](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx#L221)). Осознанный минимум — не угадывать. |

> Развилок для владельца нет — всё закрыто брифом и эмпирическим тестом §10.

---

## 5. Scope

**Входит:**
1. `package.json` build-script → `next build --webpack` (Р1).
2. `next.config.mjs` → `deploymentId` из `process.env.DEPLOYMENT_VERSION` (Р2); `Dockerfile` + `docker-compose.yml` → проброс build-arg `DEPLOYMENT_VERSION`.
3. Русские `global-error.tsx` (корень) + `error.tsx` в route-группах `(authenticated)` и `(public)` + общий компонент экрана ошибки + util определения/перезагрузки на ChunkLoadError с anti-loop (Р4).
4. Замена `<MediaPlayer>` → нативный `<video>` в [MeetingPlayer.tsx](../../frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx), [ShareMeetingClient.tsx](../../frontend/app/share/[token]/ShareMeetingClient.tsx), [ShareClipClient.tsx](../../frontend/app/share/clip/[token]/ShareClipClient.tsx); рефактор `use-vidstack-player.ts` на нативный `HTMLVideoElement`; маркеры полосой (Р3, Р5).
5. Удаление мёртвой зависимости `@vidstack/react` из `package.json` + `transpilePackages`.

**Не входит (с судьбой):**
- Английские заголовки «Summary»/«Action items» на share-странице ([ShareMeetingClient.tsx:147,173](../../frontend/app/share/[token]/ShareMeetingClient.tsx#L147)) — **вне scope** (нарушение «UI только русский», но не относится к chunk/видео). → отдельная мелкая правка локализации (не в этом ТЗ).
- blue-green / общий volume статики / ретеншн старых чанков — оверкилл при 1 реплике (отвергнуто, §3 анализа вариант C).
- Кастомные контролы видео (вернуть mint-скин на нативном `<video>`) — vNext, если владелец захочет; сейчас нативные контролы приняты (Р3).

---

## 6. Контракт (что именно поменять)

### 6.1 Сборка на webpack (Фаза 1)
[package.json:8](../../frontend/package.json#L8):
```json
"build": "next build --webpack",
```
> `dev` оставить как есть (`next dev -p 3001`) — Turbopack в dev не вызывает version skew (один процесс, нет статики в образе).

### 6.2 deploymentId + build-arg (Фаза 1)
[next.config.mjs](../../frontend/next.config.mjs) — в объект `nextConfig` добавить:
```js
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // git sha сборки → защита от version skew (hard MPA-navigation при несовпадении).
  // Пусто при локальной сборке без build-arg — это ок (skew-защита просто не активна).
  deploymentId: process.env.DEPLOYMENT_VERSION,
  transpilePackages: [
    '@livekit/components-react',
    '@livekit/components-styles',
    'livekit-client',
    // '@vidstack/react' — УДАЛИТЬ (Фаза 3, после снятия всех импортов)
  ],
  // ...headers без изменений
};
```
> `next.config.mjs` — build-time конфиг, чтение `process.env.*` здесь **штатно** (файл уже читает `process.env.NODE_ENV`, `NEXT_PUBLIC_*`). Правило «ENV только через `TypedConfigService`» относится к backend-runtime, не к next.config.

[Dockerfile](../../frontend/Dockerfile) — в стадии `builder` рядом с `NEXT_PUBLIC_*`:
```dockerfile
ARG DEPLOYMENT_VERSION
ENV DEPLOYMENT_VERSION=${DEPLOYMENT_VERSION} \
    NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    # ...остальные как есть
```
`docker-compose.yml` (сервис `frontend` → `build.args`): добавить `DEPLOYMENT_VERSION: ${DEPLOYMENT_VERSION:-}`. Деплой-команда выставляет git sha — см. §11.

### 6.3 Русский error-UX + ChunkLoadError-reload (Фаза 2)
Новый util `frontend/src/lib/chunk-reload.ts`:
```ts
const RELOAD_FLAG = 'z_chunk_reloaded';

/** ChunkLoadError (динамический import чанка не загрузился — частый при version skew). */
export function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const msg = e?.message ?? '';
  return e?.name === 'ChunkLoadError'
    || /Loading chunk [\w-]+ failed/i.test(msg)
    || /Failed to load chunk/i.test(msg);
}

/** Один тихий reload; повтор НЕ делаем (anti-loop через sessionStorage). Возвращает true, если reload запущен. */
export function tryReloadOnce(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.sessionStorage.getItem(RELOAD_FLAG)) return false; // уже перезагружались — не зацикливаемся
  window.sessionStorage.setItem(RELOAD_FLAG, '1');
  window.location.reload();
  return true;
}

/** Успешная загрузка страницы → сброс флага (следующий ChunkLoadError снова получит право на 1 reload). */
export function clearReloadFlag(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(RELOAD_FLAG);
}
```
Общий компонент `frontend/src/ui/components/AppErrorView.tsx` (`'use client'`): на `useEffect` — если `isChunkLoadError(error)` и `tryReloadOnce()` вернул true → ничего не рендерить (идёт reload); иначе — русский экран: заголовок «Не удалось загрузить страницу», текст «Обновите страницу или вернитесь назад», кнопка «Обновить» (`reset()` / `location.reload()`). **Парные токены** (`bg-*`+`text-*-fg`), без `text-white`/hex (память `feedback_paired_color_tokens`). Принимает `{ error, reset }`.

Файлы-обёртки (тонкие, импортируют `AppErrorView`):
- `frontend/app/global-error.tsx` — **обязан** содержать `<html><body>` (ловит ошибки корневого layout); `'use client'`.
- `frontend/app/(authenticated)/error.tsx` — покрывает `/tables/[id]`, `/structure/persons/[id]`, `/result`.
- `frontend/app/(public)/error.tsx` — покрывает share-страницы (если route-группа `(public)` существует; иначе разместить `error.tsx` в `app/share/`).

> На успешном маунте корневого layout вызвать `clearReloadFlag()` (в существующем root `app/layout.tsx` через маленький клиентский эффект или в `AppErrorView` при не-chunk ошибке — реализатору выбрать минимальное место; пометить `[ASSUMPTION]` если в layout).

### 6.4 Нативный `<video>` + рефактор хука (Фаза 3)
`use-vidstack-player.ts` → переписать на нативный элемент (имя файла/экспортов сохранить ради минимума правок call-site, либо переименовать в `use-video-player.ts` и обновить 1 импорт):
```ts
'use client';
import { useCallback, useRef } from 'react';

export function useVideoPlayer() {
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const seekTo = useCallback((ms: number) => {
    const el = playerRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms / 1000);
  }, []);
  const play = useCallback(async () => { await playerRef.current?.play().catch(() => undefined); }, []);
  const pause = useCallback(() => { playerRef.current?.pause(); }, []);
  const togglePlay = useCallback(() => {
    const el = playerRef.current; if (!el) return;
    if (el.paused) void el.play().catch(() => undefined); else el.pause();
  }, []);
  return { playerRef, seekTo, play, pause, togglePlay };
}
```
`MeetingPlayer.tsx` — `playerRef` тип `React.MutableRefObject<HTMLVideoElement|null>`; вместо `<MediaPlayer>`:
```tsx
<div className="relative overflow-hidden rounded-xl border border-border-subtle bg-bg-card">
  <PlayerMarkers chapters={chapters} highlights={highlights} durationMs={durationMs} />
  <video
    ref={(node) => { internalRef.current = node; if (playerRef) playerRef.current = node; }}
    src={videoUrl}
    controls
    preload="auto"
    playsInline
    onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime * 1000)}
    className="aspect-video w-full bg-black"
  />
</div>
```
`PlayerMarkers` — перенести из оверлея над скраббером в тонкую полосу НАД `<video>` (Р5): `relative` контейнер, полоса `h-1.5` сверху; позиции `left:%` как сейчас. `<MediaProvider/>`, `DefaultVideoLayout`, импорты `@vidstack/react` — убрать.
`ShareMeetingClient.tsx:131` и `ShareClipClient.tsx:106` — заменить `<MediaPlayer src={{src,type}} …>` на `<video src={videoUrl|data.videoUrl} controls preload="auto" playsInline className="aspect-video w-full bg-black" />` (для клипа сохранить `autoPlay`). Убрать импорты Vidstack.

### 6.5 Удаление мёртвой зависимости (Фаза 3, последним)
После снятия всех импортов: `package.json` — убрать `"@vidstack/react"`; `next.config.mjs` — убрать из `transpilePackages`. **Предусловие:** grep `@vidstack/react` по `frontend/src` + `frontend/app` = 0.

---

## 7. Фазы и Acceptance (машинно-проверяемо)

Граф зависимостей: **Фазы 1, 2, 3 независимы по файлам** (build-конфиг / новые error-файлы / файлы плеера не пересекаются) → можно параллелить. Рекомендуемый порядок по приоритету: 1 → 2 → 3.

### Фаза 1 — Сборка без version skew (webpack + deploymentId)
Файлы: `package.json`, `next.config.mjs`, `Dockerfile`, `docker-compose.yml`.
**Не входит:** error-страницы, плеер.
**Acceptance:**
- grep `package.json`: `"build": "next build --webpack"`.
- grep `next.config.mjs`: `deploymentId: process.env.DEPLOYMENT_VERSION`.
- grep `Dockerfile`: `ARG DEPLOYMENT_VERSION` и `DEPLOYMENT_VERSION=${DEPLOYMENT_VERSION}` в builder-стадии.
- grep `docker-compose.yml`: `DEPLOYMENT_VERSION` в `frontend.build.args`.
- `cd frontend && bun run build` — зелёная (webpack-сборка проходит).
Закрывает: R1, R2.

### Фаза 2 — Русский error-UX + ChunkLoadError-reload
Файлы: `src/lib/chunk-reload.ts`, `src/ui/components/AppErrorView.tsx`, `app/global-error.tsx`, `app/(authenticated)/error.tsx`, `app/(public)/error.tsx` (или `app/share/error.tsx`).
**Не входит:** build-конфиг, плеер.
**Acceptance:**
- файлы существуют; `global-error.tsx` содержит `<html>` и `<body>` и `'use client'`.
- `isChunkLoadError` ловит `name==='ChunkLoadError'` и текст `Failed to load chunk` / `Loading chunk … failed` (юнит-тест `chunk-reload.spec.ts`: вход→выход, вкл. negative — обычная `Error` → false).
- `tryReloadOnce` второй раз подряд возвращает `false` (anti-loop) — юнит-тест с моком `sessionStorage`.
- grep в error-файлах: 0 английских строк UI; есть «Не удалось загрузить страницу»; парные токены (нет `text-white`, нет `#`-hex, нет `slate-`).
- `bun run typecheck` (вкл. `.spec`), `bun run lint` — зелёные.
Закрывает: R3, R4.

### Фаза 3 — Нативный `<video>` во всех 3 местах + удаление Vidstack
Файлы: `use-vidstack-player.ts`(→хук), `MeetingPlayer.tsx`, `ShareMeetingClient.tsx`, `ShareClipClient.tsx`, `MeetingResultPageReal.tsx` (импорт хука), `package.json`, `next.config.mjs`.
**Не входит:** build-конфиг, error-страницы.
**Acceptance:**
- grep `<MediaPlayer` по `frontend/` = **0**; grep `from '@vidstack/react'` по `frontend/src`+`frontend/app` = **0**.
- в 3 местах есть `<video` с `controls` и `playsInline`; клип — с `autoPlay`.
- хук: `playerRef` типа `HTMLVideoElement|null`; `seekTo` ставит `el.currentTime = ms/1000`.
- `package.json` без `@vidstack/react`; `next.config.mjs` `transpilePackages` без `@vidstack/react`.
- `bun run typecheck` / `lint` / `build` — зелёные.
- ручная проверка (реализатор, локальный prod-билд `next build --webpack && next start`): `/result` с записью — `<video>.readyState>0`, играет; клик по главе перематывает.
Закрывает: R5, R6.

**Требования (EARS):**
- R1: Когда выполняется prod-сборка фронта, система shall использовать webpack (`next build --webpack`), не Turbopack.
- R2: Когда задан `DEPLOYMENT_VERSION` на сборке, система shall выставлять `deploymentId` и при несовпадении билда клиента/сервера выполнять hard MPA-navigation.
- R3: Когда клиентский `import()` чанка падает с ChunkLoadError, система shall выполнить однократный `location.reload()` с anti-loop через `sessionStorage`.
- R4: Если возникает необработанная ошибка рендера сегмента/корня, система shall показывать русский экран ошибки (без английского «This page couldn't load»).
- R5: Когда отображается видеозапись (страница результата и обе share-страницы), система shall использовать нативный `<video controls preload playsInline>`.
- R6: Когда пользователь кликает главу/хайлайт, система shall перематывать видео через `videoEl.currentTime = ms/1000`.

---

## 8. Границы фичи
- ✅ Always: правки только во `frontend/`; парные цветовые токены; русский UI; переиспользовать паттерн нативного `<audio>`.
- ⚠️ Ask first: трогать CSP в `next.config.mjs` (не нужно — `https:` уже в `media-src`); удалять зависимости помимо `@vidstack/react`.
- 🚫 Never: вводить blue-green/CDN-инфру; менять backend; оставлять английский текст в UI; `git add -A`.

## 9. Совместимость с prompt caching
Не релевантно — фронтовая стабильность, LLM не задействован.

## 10. Риски / pre-mortem (ревью-аспекты для strict-production-review-gate)
| Риск | Митигация |
|---|---|
| webpack-сборка падает на чём-то, что Turbopack прощал | Фаза 1 acceptance — `bun run build` зелёная до выката; Next 16 официально поддерживает `--webpack` (Context7) |
| `DEPLOYMENT_VERSION` не пробросился на сборке → `deploymentId=undefined` | Не ломает (skew-защита просто неактивна); §11 фиксирует команду деплоя с git sha; проверить заголовок `x-deployment-id` после выката |
| Бесконечный reload-цикл при стойком ChunkLoadError | `sessionStorage` anti-loop (Фаза 2 acceptance тест); при втором падении — русский экран, не reload |
| Маркеры глав не совпадают с нативным скраббером | Р5: маркеры полосой НАД видео + кликабельный список глав (seek сохранён) |
| Потеря mint-скина плеера замечена пользователями | Принятый компромисс (Р3); vNext — кастомные контролы при желании владельца |
| Остался импорт `@vidstack/react` где-то ещё | Фаза 3 acceptance — grep = 0 перед удалением зависимости |

## 11. Prod-deploy
- **Build-arg `DEPLOYMENT_VERSION`** (git sha) — новый. Деплой фронта: `DEPLOYMENT_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build frontend` (или прокинуть в `.env`). → запись в `docs/operations/prod-deploy-log.md` **Шаг 1** (build-arg фронта; не runtime-ENV backend, в `env.schema.ts` НЕ добавляется).
- Схема БД / сиды / очереди / backend — **не меняются**. Миграций нет.
- Выкат: `docker compose up -d --build frontend` пересоберёт фронт на webpack с новым `deploymentId`.

## 12. DoD
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` (webpack) зелёные; юнит-тест `chunk-reload.spec.ts` зелёный.
- grep: `<MediaPlayer` = 0, `from '@vidstack/react'` = 0, английский UI в error-файлах = 0.
- `second-brain/01_projects/frontend-pages.md` — отметить нативный плеер + error-boundary; `02_architecture/code-pitfalls.md` — грабля «Turbopack-prod ChunkLoadError + Vidstack не инициализируется».
- `docs/operations/prod-deploy-log.md` Шаг 1 — build-arg `DEPLOYMENT_VERSION`.
- Рефлексия в `second-brain/05_история/`.

## Итог
_(заполнит tz-orchestrator: webpack-сборка прошла? видео играет на проде? buildId совпал? остаточные импорты Vidstack?)_
