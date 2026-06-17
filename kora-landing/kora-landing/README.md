# КОРА — лендинг

Одностраничный лендинг КОРА (AI операционный директор) на **Next.js 16 + React 19 + Tailwind v4 + shadcn**.

## Запуск

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # продакшен-сборка
npm run start    # запуск собранного
```

## Структура

```
app/
  layout.tsx              SEO-метаданные, шрифт Manrope, базовый layout
  page.tsx                сборка главной: hero → блоки → итог
  globals.css             дизайн-токены КОРА (цвета, kora-glass, градиенты)
components/site/
  header.tsx              шапка; логотип — зацикленное видео (logo-breathe.mp4)
  hero-overlay.tsx        hero: картинка-фон + заголовок живым HTML (десктоп/мобайл)
  problem-solution.tsx    переиспользуемый блок «боль → решение»
  blocks-data.ts          тексты блоков (договорённости, знания, цели)
  summary-block.tsx       финальный блок-итог о платформе
  footer.tsx              футер
  logo.tsx, button-link.tsx
public/
  *2-desktop.png / *2-mobile.png  иллюстрации блоков (16:9 и 4:5), отдаются адаптивно
  hero-desktop/mobile.png         hero без заголовка (текст накладывается в коде)
  logo-breathe.mp4                видео-логотип
```

## Принцип блоков

Иллюстрации сгенерированы ИИ **без впечённого текста**; заголовки и тексты — живой HTML
(для SEO и чёткости). На каждый блок две картинки: широкая (десктоп, 16:9) и вертикальная
(мобайл, 4:5), переключаются через `next/image` + адаптивные классы.

Картинки в 2K; на сайте `next/image` автоматически отдаёт WebP/AVIF нужного размера.
