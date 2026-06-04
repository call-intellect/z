# ТЗ: Перенос kora-landing.html как главной страницы

**Дата:** 2026-05-28  
**Статус:** [ ] В работе

## Цель

Сделать дизайн `kora-landing.html` (тёмный, цвет янтаря, шрифт Fraunces) главной страницей приложения — вместо текущего `HomeClient.tsx` (минт/бирюза).

Страница должна быть полноценной: подключены вход и регистрация, работает политика конфиденциальности, авторизованный пользователь редиректится на /dashboard.

---

## Что уже есть (не нужно создавать)

| Маршрут | Файл | Статус |
|---|---|---|
| `/login` | `app/login/page.tsx` | ✓ работает |
| `/signup` | `app/signup/page.tsx` | ✓ работает |
| `/privacy` | `app/(public)/privacy/page.tsx` | ✓ полный текст |
| `/terms` | `app/(public)/terms/page.tsx` | ✓ есть |
| Auth-редирект (залогинен → /dashboard) | `HomeClient.tsx` строки 57-69 | ✓ перенести |

---

## Фазы

### Фаза 1: Шрифты [ ]

**Файл:** `frontend/app/layout.tsx`

Добавить Google Fonts: `Fraunces` (opsz, weight 300/400/500/600, italic) + `Manrope` (weight 300–700).

Текущие шрифты приложения трогать нельзя — добавляем как дополнительную переменную. Шрифты нужны только для лендинга, поэтому грузить через `<link>` в самом компоненте (как в HTML-файле), а не через `next/font` в layout — чтобы не замедлять весь сайт.

**Решение:** оставить `<link>` тегами прямо в компоненте лендинга (через `next/head` или просто вставить в `<head>` через metadata). На практике проще всего — CSS-переменные объявлены внутри CSS-модуля, а `@import` Google Fonts добавить туда же.

---

### Фаза 2: CSS-модуль [ ]

**Новый файл:** `frontend/app/landing.module.css`

Взять весь блок `<style>` из `kora-landing.html` (строки 14–706) и перенести в CSS-модуль. Причина изоляции: приложение использует минт/бирюзовый дизайн (`--accent: teal`), лендинг — янтарь (`--accent: #D4A574`). Глобальный конфликт переменных ломает дизайн.

Что адаптировать при переносе:
- `:root { ... }` → оставить (будет скоуплен к компоненту через `:local` в CSS-модуле или через обёртку с `data-landing`)
- Класс `wrap`, `reveal`, `in` и т.д. → становятся `styles.wrap`, `styles.reveal` и т.д.
- Медиа-запросы (`@media`) → переносятся как есть
- Анимации (`@keyframes`) → переносятся как есть

Альтернативный подход (проще): использовать `data-theme="landing"` атрибут на корневом `<div>` и вставить CSS в `globals.css` под этим селектором — тогда не нужно `.module.css` переименование классов.

**Рекомендуемый подход:** `data-theme="landing"` на корневом `<div>`, стили в отдельном файле `landing-theme.css`, импортируемом только в `HomeClient.tsx`.

---

### Фаза 3: Компонент `HomeClient.tsx` [ ]

Полностью переписать `frontend/app/HomeClient.tsx`.

**Структура компонента:**

```
HomeClient
  ├── auth-guard (оставить как есть — строки 57-69 текущего файла)
  ├── <div data-theme="landing">
  │   ├── <Header />           — sticky, blur, логотип КОРА·, nav: Войти / Ранний доступ
  │   ├── <HeroSection />      — eyebrow, h1, lead, CTA-кнопки, hero-note
  │   ├── <ToolsSection />     — id="tools", 4 группы × 3 карточки
  │   ├── <PainSection />      — id="pain", 6 строк боль/решение
  │   ├── <HowSection />       — id="how", 4 шага
  │   ├── <SprintsSection />   — id="sprints", 4 пункта
  │   ├── <SourcesStrip />     — 6 источников
  │   ├── <MemorySection />    — id="memory", 3 карточки
  │   ├── <ReviewsSection />   — id="reviews", 3 отзыва
  │   ├── <PrivacyBlock />     — § секция (данные только ваши)
  │   ├── <FinalCta />         — id="cta", две кнопки
  │   └── <Footer />           — ссылки /privacy и /terms
  └── </div>
```

**Кнопки CTA — конкретные маршруты:**
- «Получить ранний доступ» → `<Link href="/signup">`
- «Войти» → `<Link href="/login">`

**Footer — конкретные маршруты:**
- «Договор оферты» → `<Link href="/terms">`
- «Политика конфиденциальности» → `<Link href="/privacy">`

**Якорные ссылки в хедере:**
- Навигационные пункты (если добавим) → `<a href="#tools">`, `<a href="#pain">` и т.д. (нативный scroll-behavior: smooth из CSS)

**Анимации reveal:**

Текущий HTML использует `IntersectionObserver` — перенести в хук `useReveal`:

```tsx
function useReveal(ref: RefObject<Element>) {
  useEffect(() => {
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { e.target.classList.add('in'); io.disconnect(); } },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 }
    );
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [ref]);
}
```

Или проще: один `useEffect` в корне компонента (как в оригинальном HTML) — вешает `IntersectionObserver` на все `.reveal` элементы после mount.

**Рекомендуется:** один `useEffect` после mount — меньше кода, идентично оригиналу.

---

### Фаза 4: Метаданные страницы [ ]

**Файл:** `frontend/app/page.tsx`

Обновить `metadata`:

```ts
export const metadata: Metadata = {
  title: 'КОРА — компании растут, когда добивают цели',
  description: 'Видеовстречи, задачи, спринты и память компании в одном месте. Кора следит, чтобы точно добивались.',
};
```

---

### Фаза 5: Проверка [ ]

- [ ] `bun run typecheck` в `frontend/` — ноль ошибок
- [ ] `bun run build` в `frontend/` — успешная сборка
- [ ] Открыть `/` — отображается новый лендинг (янтарь, Fraunces)
- [ ] Открыть `/` залогиненным — редирект на `/dashboard`
- [ ] Кнопка «Получить ранний доступ» → открывает `/signup`
- [ ] Кнопка «Войти» → открывает `/login`
- [ ] Ссылка «Политика конфиденциальности» в футере → открывает `/privacy`
- [ ] Reveal-анимации работают при скролле
- [ ] Мобильная версия (≤768px) — нет горизонтального скролла, читаемо
- [ ] Старый `HomeClient.tsx` полностью заменён, нет импортов из него

---

## Что НЕ делаем в этом ТЗ

- Не трогаем `/login`, `/signup`, `/privacy`, `/terms` — они уже работают
- Не меняем глобальный дизайн приложения (layout.tsx, globals.css)
- Не добавляем новые бэкенд-эндпоинты — лендинг статический
- Не мигрируем существующий React-лендинг (HomeClient.tsx) — он заменяется целиком
- `kora-landing.html` оставляем в корне как эталон — не удаляем

---

## Итог

После выполнения: `/` показывает новый лендинг (янтарь, Fraunces), кнопки ведут на `/signup` и `/login`, футер — на `/privacy` и `/terms`, залогиненный пользователь редиректится на `/dashboard`.
