'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, X } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';

/* ------------------------------------------------------------------ */
/* Внешние ссылки и тексты блоков (копирайт образца kora-landing)      */
/* ------------------------------------------------------------------ */

const TELEGRAM_URL = 'https://t.me/SERGEYMZ80';
const WIKI_URL = '/wiki/index.html';
const DEMO_URL = '/demo/index.html';

interface BlockData {
  id: string;
  eyebrow: string;
  headingLead: string;
  headingAccent: string;
  intro: string;
  /** базовое имя картинок: /landing/{image}-desktop.webp и -mobile.webp */
  image: string;
  imageAlt: string;
  painsTitle: string;
  pains: string[];
  gainsTitle: string;
  gains: string[];
}

const BLOCK_COMMUNICATION: BlockData = {
  id: 'communication',
  eyebrow: 'Боли клиента',
  headingLead: 'От хаоса в общении — к',
  headingAccent: 'управляемой команде',
  intro:
    'Команды теряют не в работе, а в коммуникации. Договорённости из встреч, чатов и звонков не превращаются в задачи — бизнес держится на памяти сотрудников и ручном контроле руководителя. Кора закрывает этот разрыв: превращает разговоры в зафиксированные договорённости, задачи и сроки.',
  image: 'compare2',
  imageAlt:
    'Слева — хаос разрозненных встреч, чатов и задач без Коры; справа — единый управляемый процесс с Корой',
  painsTitle: 'Без Коры — как сейчас',
  pains: [
    'Договорённости со встреч не фиксируются — каждый запомнил по-своему.',
    'Задачи теряются между чатами, почтой и звонками.',
    'Непонятно, кто за что отвечает и на каком этапе работа.',
    'Итоги встреч живут в переписках, к ним невозможно вернуться.',
    'Руководитель контролирует всё вручную — и всё равно что-то упускает.',
  ],
  gainsTitle: 'С Корой — как становится',
  gains: [
    'Собирает встречи, чаты и звонки в одном месте.',
    'Фиксирует договорённости и формирует протокол встречи.',
    'Автоматически распределяет задачи и назначает ответственных.',
    'Держит сроки и показывает статус по каждой задаче.',
    'Руководитель управляет результатом, а не ручным контролем.',
  ],
};

const BLOCK_KNOWLEDGE: BlockData = {
  id: 'knowledge',
  eyebrow: 'Знания компании',
  headingLead: 'От знаний в чужих головах — ко',
  headingAccent: 'второму мозгу компании',
  intro:
    'Главный актив компании — знания о процессах, клиентах и договорённостях — обычно разбросаны по чатам, таблицам и головам сотрудников. Их трудно найти, они забываются, а с уходом человека уходят вместе с ним. Кора собирает всё в единую базу и превращает знания в растущий актив.',
  image: 'knowledge2',
  imageAlt:
    'Слева — знания теряются в чатах, таблицах и головах без Коры; справа — единый «второй мозг» компании с Корой',
  painsTitle: 'Без Коры — как сейчас',
  pains: [
    'Данные о процессах, договорённостях и решениях — в головах руководителей.',
    'Информация разрознена по чатам и таблицам.',
    'Со временем знания теряются и забываются.',
    'Чтобы найти нужное, уходит много времени.',
    'Сотрудник в отпуске или уволился — знания ушли вместе с ним.',
  ],
  gainsTitle: 'С Корой — как становится',
  gains: [
    'Видеовстречи, чаты и переписки собираются в одном месте.',
    'Мысли руководителя и команды фиксируются и не теряются.',
    'Отчёты и документы структурно пополняют базу знаний.',
    'Помощник компании отвечает на любой вопрос по знаниям.',
    'Цифровой двойник ответит за сотрудника, даже если он в отпуске или ушёл.',
  ],
};

const BLOCK_GOALS: BlockData = {
  id: 'goals',
  eyebrow: 'Боли клиента',
  headingLead: 'Почему цели не достигаются, а команда',
  headingAccent: 'буксует',
  intro:
    'Руководитель тонет в операционке и не видит полной картины: где буксуют задачи, что блокирует движение и почему цели снова не закрыты. Кора работает как операционный директор — сравнивает цели команды с фактом, держит вектор движения и каждый день показывает, что идёт не так.',
  image: 'goals2',
  imageAlt:
    'Слева — руководитель в операционном хаосе без Коры; справа — командный центр с целями, план-фактом и контролем 96% с Корой',
  painsTitle: 'Без Коры — как сейчас',
  pains: [
    'Руководитель погряз в операционке вместо стратегии.',
    'Нет полного контроля за выполнением задач.',
    'Цели теряются — задачи не выполняются.',
    'Не видно в моменте, где проблемы с командой и процессами.',
    'Не видно, что именно блокирует движение вперёд.',
  ],
  gainsTitle: 'С Корой — как становится',
  gains: [
    'Ежедневный диалог с командой — пульс всей системы.',
    'Сравнивает цели команды и каждого сотрудника с фактом.',
    'План / факт по задачам и результатам в реальном времени.',
    'Лента проблем и блокираторов между людьми и процессами.',
    'У руководителя освобождается время на стратегию и жизнь.',
  ],
};

const SUMMARY_POINTS = [
  'Встречи, задачи и решения собираются в одном месте.',
  'Кора следит, чтобы договорённости не терялись.',
  'Руководитель управляет результатом, а не ручным контролем.',
];

/* ------------------------------------------------------------------ */
/* Главная страница                                                   */
/* ------------------------------------------------------------------ */

export function HomeClient() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  // Авторизованного — сразу в кабинет.
  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, router]);

  // Шапка «застекляется» при прокрутке.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Reveal-анимации блоков при попадании в зону видимости.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    document.querySelectorAll('.kora-landing .kl-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Заглушка на момент до редиректа авторизованного пользователя.
  if (user) {
    return <div className="min-h-screen" style={{ background: '#f7f8fb' }} />;
  }

  return (
    <div className="kora-landing">
      <LandingStyles />

      {/* ===================== ШАПКА ===================== */}
      <header className="kl-header">
        <div className={`kl-headbar${scrolled ? ' is-scrolled' : ''}`}>
          <Link href="/" className="kl-brand" aria-label="Кора — на главную">
            <span className="kl-brand-mark">К</span>
            <span className="kl-brand-name">КОРА</span>
          </Link>

          <nav className="kl-nav">
            <a href="#communication">Договорённости</a>
            <a href="#knowledge">Знания</a>
            <a href="#goals">Цели</a>
            <a href="#summary">Платформа</a>
            <a href={DEMO_URL}>Демо</a>
            <a href={WIKI_URL} target="_blank" rel="noopener noreferrer">
              Инструкция
            </a>
          </nav>

          <div className="kl-actions">
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="kl-btn kl-btn-ghost kl-hide-sm"
            >
              Связаться
            </a>
            <Link href="/login" className="kl-btn kl-btn-outline">
              Войти
            </Link>
            <Link href="/signup" className="kl-btn kl-btn-primary kl-hide-sm">
              Получить ранний доступ
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ===================== HERO ===================== */}
        <section className="kl-section kl-hero-section" id="top">
          <div className="kl-wrap">
            <div className="kl-hero">
              <Image
                unoptimized
                src="/landing/hero-mobile.webp"
                alt=""
                fill
                priority
                sizes="100vw"
                className="kl-hero-img kl-only-mobile"
              />
              <Image
                unoptimized
                src="/landing/hero-desktop.webp"
                alt=""
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 1024px"
                className="kl-hero-img kl-only-desktop"
              />
              <p className="kl-hero-eyebrow">Прозрейте в своём бизнесе</p>
              <h1 className="kl-hero-title">
                <span className="kl-hero-accent">Запустим оцифровку</span>
                <span>вашего бизнеса и команды за 1 день</span>
              </h1>
            </div>

            <div className="kl-hero-ctas">
              <Link href="/signup" className="kl-btn kl-btn-primary kl-btn-lg">
                Получить ранний доступ
              </Link>
              <a href={DEMO_URL} className="kl-btn kl-btn-outline kl-btn-lg">
                Посмотреть демо-кабинет
                <ArrowRight size={17} />
              </a>
            </div>
            <p className="kl-hero-note">
              Встречи, задачи, спринты и память компании — в одном месте.
            </p>
          </div>
        </section>

        {/* ===================== ДОГОВОРЁННОСТИ ===================== */}
        <ProblemSolution data={BLOCK_COMMUNICATION} />

        {/* ===================== ЗНАНИЯ ===================== */}
        <ProblemSolution data={BLOCK_KNOWLEDGE} />

        {/* плашка-переход после «Знания» */}
        <DemoBanner />

        {/* ===================== ЦЕЛИ ===================== */}
        <ProblemSolution data={BLOCK_GOALS} />

        {/* плашка-переход после «Цели» */}
        <DemoBanner />

        {/* ===================== ПЛАТФОРМА / ИТОГ ===================== */}
        <SummaryBlock />
      </main>

      {/* ===================== ФУТЕР ===================== */}
      <footer className="kl-footer">
        <div className="kl-wrap kl-footer-inner">
          <div className="kl-footer-brand">
            <Link href="/" className="kl-brand">
              <span className="kl-brand-mark">К</span>
              <span className="kl-brand-name">КОРА</span>
            </Link>
            <p>Память вашей компании, которая превращает разговоры команды в выполненные цели.</p>
          </div>
          <div className="kl-footer-links">
            <a href={DEMO_URL}>Демо-кабинет</a>
            <a href={WIKI_URL} target="_blank" rel="noopener noreferrer">
              Инструкция
            </a>
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Связаться
            </a>
            <Link href="/terms">Договор оферты</Link>
            <Link href="/privacy">Политика конфиденциальности</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Блок «боль → решение»                                              */
/* ------------------------------------------------------------------ */

function ProblemSolution({ data }: { data: BlockData }) {
  return (
    <section className="kl-section kl-ps" id={data.id}>
      <div className="kl-wrap">
        <div className="kl-ps-head kl-reveal">
          <p className="kl-eyebrow">{data.eyebrow}</p>
          <h2 className="kl-h2">
            {data.headingLead} <span className="kl-grad-text">{data.headingAccent}</span>
          </h2>
          <p className="kl-intro">{data.intro}</p>
        </div>

        <div className="kl-ps-img kl-reveal">
          <Image
            unoptimized
            src={`/landing/${data.image}-mobile.webp`}
            alt={data.imageAlt}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="kl-ps-img-el kl-only-mobile"
          />
          <Image
            unoptimized
            src={`/landing/${data.image}-desktop.webp`}
            alt={data.imageAlt}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="kl-ps-img-el kl-only-desktop"
          />
        </div>

        <div className="kl-ps-cols kl-reveal">
          <div className="kl-card kl-pains">
            <h3>{data.painsTitle}</h3>
            <ul>
              {data.pains.map((t) => (
                <li key={t}>
                  <X size={20} className="kl-ico-x" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="kl-glass kl-gains">
            <h3>{data.gainsTitle}</h3>
            <ul>
              {data.gains.map((t) => (
                <li key={t}>
                  <Check size={20} className="kl-ico-check" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Плашка-переход «→ Посмотреть демо-кабинет»                          */
/* ------------------------------------------------------------------ */

function DemoBanner() {
  return (
    <section className="kl-section kl-demo-section">
      <div className="kl-wrap">
        <a href={DEMO_URL} className="kl-demo-banner kl-reveal">
          <div className="kl-demo-banner-text">
            <p className="kl-eyebrow">Живой кабинет</p>
            <h3>Посмотреть демо-кабинет</h3>
            <p className="kl-demo-banner-sub">
              Дашборды, лента Коры, задачи и память — на демо-данных, без регистрации.
            </p>
          </div>
          <span className="kl-demo-banner-cta">
            Открыть демо
            <ArrowRight size={20} />
          </span>
        </a>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Финальный блок-итог «Платформа Кора»                               */
/* ------------------------------------------------------------------ */

function SummaryBlock() {
  return (
    <section className="kl-section kl-summary-section" id="summary">
      <div className="kl-wrap">
        <div className="kl-glass kl-summary kl-reveal">
          <div className="kl-summary-text">
            <p className="kl-eyebrow">Платформа Кора</p>
            <h2 className="kl-h2">
              Превращает разговоры команды в <span className="kl-grad-text">выполненные цели</span>
            </h2>
            <p className="kl-intro">
              Договорённости, знания и цели больше не теряются в чатах и головах. Кора собирает всё
              в одном месте, фиксирует решения и доводит задачи до результата — а руководитель
              управляет, а не тушит пожары.
            </p>
            <ul className="kl-summary-points">
              {SUMMARY_POINTS.map((t) => (
                <li key={t}>
                  <CheckCircle2 size={20} className="kl-ico-blue" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="kl-summary-ctas">
              <Link href="/signup" className="kl-btn kl-btn-primary kl-btn-lg">
                Получить ранний доступ
              </Link>
              <Link href="/login" className="kl-btn kl-btn-outline kl-btn-lg">
                Войти
              </Link>
            </div>
          </div>
          <div className="kl-summary-img">
            <Image
              unoptimized
              src="/landing/summary2-mobile.webp"
              alt="Платформа Кора: ядро и все договорённости под контролем — 98% выполнено"
              fill
              sizes="(max-width: 1024px) 100vw, 512px"
              className="kl-ps-img-el kl-only-mobile"
            />
            <Image
              unoptimized
              src="/landing/summary2-desktop.webp"
              alt="Платформа Кора: ядро и все договорённости под контролем — 98% выполнено"
              fill
              sizes="(max-width: 1024px) 100vw, 512px"
              className="kl-ps-img-el kl-only-desktop"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Scoped-стили лендинга (светлая тема, не зависит от темы приложения) */
/* ------------------------------------------------------------------ */

function LandingStyles() {
  return (
    <style>{`
      .kora-landing {
        --kl-blue: oklch(0.55 0.225 264);
        --kl-blue-2: oklch(0.62 0.19 250);
        --kl-violet: oklch(0.58 0.20 285);
        --kl-ink: oklch(0.23 0.04 263);
        --kl-muted: oklch(0.50 0.03 260);
        --kl-faint: oklch(0.62 0.02 265);
        --kl-border: oklch(0.90 0.012 256);
        --kl-card: oklch(1 0 0);
        --kl-rose: oklch(0.66 0.19 18);
        --kl-emerald: oklch(0.66 0.15 162);
        --kl-grad: linear-gradient(100deg, var(--kl-blue), var(--kl-violet));
        --kl-container: 1120px;
        --kl-pad: 24px;

        position: relative;
        min-height: 100vh;
        color: var(--kl-ink);
        font-family: var(--font-geist-sans, system-ui, sans-serif);
        font-size: 16px;
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        overflow-x: hidden;
        background-color: oklch(0.985 0.006 256);
        background-image:
          radial-gradient(48rem 48rem at 88% -8%, oklch(0.55 0.225 264 / 0.10), transparent 60%),
          radial-gradient(40rem 40rem at 4% 0%, oklch(0.58 0.20 285 / 0.08), transparent 55%);
        background-attachment: fixed;
      }
      .kora-landing * { box-sizing: border-box; }
      .kora-landing a { text-decoration: none; color: inherit; }

      .kl-wrap { max-width: var(--kl-container); margin: 0 auto; padding: 0 var(--kl-pad); }
      .kl-section { padding: 64px 0; }
      .kl-only-mobile { display: block; }
      .kl-only-desktop { display: none; }
      @media (min-width: 768px) {
        .kl-only-mobile { display: none; }
        .kl-only-desktop { display: block; }
      }

      /* glass / gradient utilities */
      .kl-glass {
        background: color-mix(in oklch, white 72%, transparent);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid color-mix(in oklch, white 60%, var(--kl-border));
        box-shadow:
          0 1px 0 0 oklch(1 0 0 / 0.6) inset,
          0 20px 50px -24px oklch(0.55 0.18 264 / 0.40);
      }
      .kl-grad-text {
        background: var(--kl-grad);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      /* ===== Кнопки ===== */
      .kl-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        padding: 10px 18px; border-radius: 12px; font-size: 14px; font-weight: 600;
        line-height: 1; cursor: pointer; border: 1px solid transparent; white-space: nowrap;
        transition: transform .15s, box-shadow .2s, background .2s, border-color .2s, color .2s;
      }
      .kl-btn-lg { padding: 14px 24px; font-size: 15px; border-radius: 14px; }
      .kl-btn-primary {
        color: oklch(0.99 0 0); background: var(--kl-grad);
        box-shadow: 0 10px 26px -10px oklch(0.55 0.2 270 / 0.55);
      }
      .kl-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 14px 30px -10px oklch(0.55 0.2 270 / 0.6); }
      .kl-btn-outline { color: var(--kl-ink); border-color: var(--kl-border); background: color-mix(in oklch, white 60%, transparent); }
      .kl-btn-outline:hover { border-color: var(--kl-blue); color: var(--kl-blue); transform: translateY(-1px); }
      .kl-btn-ghost { color: var(--kl-muted); background: transparent; }
      .kl-btn-ghost:hover { color: var(--kl-ink); }

      /* ===== Шапка ===== */
      .kl-header { position: fixed; inset: 12px 0 auto; z-index: 50; display: flex; justify-content: center; padding: 0 16px; pointer-events: none; }
      .kl-headbar {
        pointer-events: auto;
        display: flex; align-items: center; gap: 18px; width: 100%; max-width: 1180px;
        padding: 10px 14px 10px 16px; border-radius: 18px;
        border: 1px solid transparent; background: transparent;
        transition: background .3s, border-color .3s, box-shadow .3s;
      }
      .kl-headbar.is-scrolled {
        background: color-mix(in oklch, white 72%, transparent);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        border-color: color-mix(in oklch, white 60%, var(--kl-border));
        box-shadow: 0 10px 30px -16px oklch(0.4 0.06 265 / 0.35);
      }
      .kl-brand { display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0; }
      .kl-brand-mark {
        width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
        font-weight: 800; font-size: 16px; color: oklch(0.99 0 0); background: var(--kl-grad);
        box-shadow: 0 8px 20px -8px oklch(0.55 0.2 270 / 0.6);
      }
      .kl-brand-name { font-weight: 800; font-size: 18px; letter-spacing: -0.01em; color: var(--kl-ink); }
      .kl-nav { display: none; align-items: center; gap: 4px; margin: 0 auto; }
      .kl-nav a {
        padding: 8px 12px; border-radius: 10px; font-size: 14px; font-weight: 500; color: var(--kl-muted);
        transition: background .15s, color .15s;
      }
      .kl-nav a:hover { background: oklch(0.55 0.18 264 / 0.07); color: var(--kl-ink); }
      .kl-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
      @media (min-width: 980px) { .kl-nav { display: flex; } .kl-actions { margin-left: 0; } }

      /* ===== Hero ===== */
      .kl-hero-section { padding-top: 104px; }
      .kl-hero {
        position: relative; width: 100%; overflow: hidden; border-radius: 24px;
        aspect-ratio: 4 / 5;
        container-type: inline-size;
        box-shadow: 0 30px 70px -34px oklch(0.4 0.08 265 / 0.5);
        border: 1px solid oklch(0 0 0 / 0.05);
      }
      @media (min-width: 768px) { .kl-hero { aspect-ratio: 16 / 9; } }
      .kl-hero-img { object-fit: cover; }
      .kl-hero-eyebrow {
        position: absolute; left: 50%; top: 3%; transform: translateX(-50%);
        white-space: nowrap; text-align: center; font-weight: 600; letter-spacing: 0.02em;
        font-size: 3cqw; color: var(--kl-muted); margin: 0;
      }
      .kl-hero-title {
        position: absolute; left: 50%; top: 7%; transform: translateX(-50%);
        width: 90%; text-align: center; font-weight: 800; line-height: 1.12; letter-spacing: -0.02em;
        font-size: 4.1cqw; margin: 0;
      }
      .kl-hero-title span { display: block; }
      .kl-hero-accent { color: var(--kl-blue); }
      .kl-hero-title span:last-child { color: var(--kl-ink); }
      @media (min-width: 768px) {
        .kl-hero-eyebrow { top: 5.5%; font-size: 1.7cqw; }
        .kl-hero-title { top: 10%; width: 72%; font-size: 3.3cqw; }
      }
      .kl-hero-ctas { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 32px; }
      .kl-hero-note { text-align: center; margin: 16px 0 0; font-size: 14px; color: var(--kl-faint); }

      /* ===== Блок боль→решение ===== */
      .kl-ps-head { max-width: 760px; margin: 0 auto; text-align: center; }
      .kl-eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--kl-blue); margin: 0; }
      .kl-h2 { font-size: clamp(28px, 4vw, 40px); font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; margin: 12px 0 0; color: var(--kl-ink); }
      .kl-intro { font-size: 17px; line-height: 1.6; color: var(--kl-muted); margin: 16px 0 0; }

      .kl-ps-img {
        position: relative; width: 100%; max-width: 760px; margin: 40px auto 0; overflow: hidden;
        border-radius: 20px; aspect-ratio: 4 / 5; box-shadow: 0 24px 60px -30px oklch(0.4 0.08 265 / 0.45);
        border: 1px solid oklch(0 0 0 / 0.05);
      }
      @media (min-width: 768px) { .kl-ps-img { aspect-ratio: 16 / 9; } }
      .kl-ps-img-el { object-fit: cover; }

      .kl-ps-cols { display: grid; gap: 20px; margin-top: 40px; }
      @media (min-width: 768px) { .kl-ps-cols { grid-template-columns: 1fr 1fr; } }
      .kl-pains, .kl-gains { border-radius: 20px; padding: 26px; }
      .kl-pains { background: color-mix(in oklch, white 64%, transparent); border: 1px solid var(--kl-border); backdrop-filter: blur(8px); }
      .kl-pains h3 { color: var(--kl-muted); }
      .kl-gains h3 { color: var(--kl-blue); }
      .kl-pains h3, .kl-gains h3 { font-size: 19px; font-weight: 700; margin: 0 0 16px; }
      .kl-pains ul, .kl-gains ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
      .kl-pains li, .kl-gains li { display: flex; gap: 12px; font-size: 15px; line-height: 1.4; color: var(--kl-ink); }
      .kl-ico-x { color: var(--kl-rose); flex: none; margin-top: 1px; }
      .kl-ico-check { color: var(--kl-emerald); flex: none; margin-top: 1px; }
      .kl-ico-blue { color: var(--kl-blue); flex: none; margin-top: 1px; }

      /* ===== Плашка-переход на демо ===== */
      .kl-demo-section { padding: 24px 0; }
      .kl-demo-banner {
        display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap;
        padding: 28px 32px; border-radius: 22px; cursor: pointer;
        background:
          radial-gradient(120% 160% at 0% 0%, oklch(0.55 0.225 264 / 0.12), transparent 55%),
          color-mix(in oklch, white 72%, transparent);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        border: 1px solid color-mix(in oklch, var(--kl-blue) 22%, var(--kl-border));
        box-shadow: 0 20px 50px -26px oklch(0.55 0.18 264 / 0.45);
        transition: transform .2s, box-shadow .2s;
      }
      .kl-demo-banner:hover { transform: translateY(-2px); box-shadow: 0 28px 60px -26px oklch(0.55 0.18 264 / 0.55); }
      .kl-demo-banner h3 { font-size: 24px; font-weight: 800; letter-spacing: -0.01em; margin: 8px 0 0; color: var(--kl-ink); }
      .kl-demo-banner-sub { font-size: 15px; color: var(--kl-muted); margin: 6px 0 0; }
      .kl-demo-banner-cta {
        display: inline-flex; align-items: center; gap: 8px; flex: none;
        padding: 13px 22px; border-radius: 14px; font-size: 15px; font-weight: 700;
        color: oklch(0.99 0 0); background: var(--kl-grad);
        box-shadow: 0 12px 28px -10px oklch(0.55 0.2 270 / 0.55);
      }

      /* ===== Итог ===== */
      .kl-summary { border-radius: 28px; padding: 40px; display: grid; gap: 32px; align-items: center; }
      @media (min-width: 900px) { .kl-summary { grid-template-columns: 1fr 1fr; padding: 56px; } }
      .kl-summary .kl-eyebrow, .kl-summary .kl-h2, .kl-summary .kl-intro { text-align: left; margin-left: 0; }
      .kl-summary-points { list-style: none; margin: 24px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
      .kl-summary-points li { display: flex; gap: 12px; font-size: 15px; color: var(--kl-ink); }
      .kl-summary-ctas { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
      .kl-summary-img {
        position: relative; width: 100%; overflow: hidden; border-radius: 20px;
        aspect-ratio: 4 / 5; border: 1px solid oklch(0 0 0 / 0.05);
        box-shadow: 0 24px 60px -30px oklch(0.4 0.08 265 / 0.45);
      }
      @media (min-width: 900px) { .kl-summary-img { aspect-ratio: 4 / 5; } }

      /* ===== Футер ===== */
      .kl-footer { border-top: 1px solid var(--kl-border); padding: 40px 0; margin-top: 24px; }
      .kl-footer-inner { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; justify-content: space-between; }
      .kl-footer-brand { max-width: 360px; }
      .kl-footer-brand p { font-size: 14px; color: var(--kl-muted); margin: 12px 0 0; line-height: 1.55; }
      .kl-footer-links { display: flex; flex-wrap: wrap; gap: 14px 22px; }
      .kl-footer-links a { font-size: 14px; color: var(--kl-muted); transition: color .15s; }
      .kl-footer-links a:hover { color: var(--kl-blue); }

      /* ===== Reveal ===== */
      .kl-reveal { opacity: 0; transform: translateY(26px); transition: opacity .8s cubic-bezier(.2,.6,.2,1), transform .8s cubic-bezier(.2,.6,.2,1); }
      .kl-reveal.in { opacity: 1; transform: none; }

      .kl-hide-sm { display: none; }
      @media (min-width: 720px) { .kl-hide-sm { display: inline-flex; } }

      @media (prefers-reduced-motion: reduce) {
        .kora-landing * { transition: none !important; animation: none !important; }
        .kl-reveal { opacity: 1; transform: none; }
      }
    `}</style>
  );
}
