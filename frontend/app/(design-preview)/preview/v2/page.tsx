'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// V2 — «Операционный» вариант: минт-акцент, Manrope, другая структура

const PAIN_ITEMS = [
  { n: '01', problem: 'Решили на планёрке — забыли через неделю', fix: 'Цель живёт в спринте, Кора возвращает к ней каждую неделю' },
  { n: '02', problem: 'Задачи зависают, вы узнаёте последним', fix: 'Кора слышит, что застряло, — подсвечивает до того, как сорвётся срок' },
  { n: '03', problem: 'Статусы зелёные — движения нет', fix: 'Кора видит правду из встреч и чатов, а не из галочек' },
  { n: '04', problem: 'Клиенту пообещали — не сделали', fix: 'Обещание на встрече = задача на исполнителе' },
  { n: '05', problem: 'Ключевой человек ушёл — знания с ним', fix: 'Цифровой двойник остаётся, новый входит в курс за минуту' },
  { n: '06', problem: 'Тонете в операционке, нет времени на стратегию', fix: 'AI-директор берёт рутину — голова освобождается' },
];

const FEATURES = [
  {
    tag: 'Встречи',
    title: 'Видеовстречи с AI-отчётом',
    text: 'Запись и расшифровка — автоматически. Отчёт под тип встречи готов через минуту после окончания. Гость по ссылке — без регистрации.',
    detail: ['Один-на-один', 'Разбор сделки', 'Ретроспектива', 'Собеседование'],
  },
  {
    tag: 'Задачи',
    title: 'Задачи появляются сами',
    text: 'Кора слышит «Иван, сделай к пятнице» — задача уже на Иване. То же из переписок. Трекер остаётся привычным, только умнее.',
    detail: ['Доски и статусы', 'Сроки и исполнители', 'Спринты', 'Интеграция с чатами'],
  },
  {
    tag: 'Спринты',
    title: 'Недельный ритм с контролем цели',
    text: 'Ставите цель — идёте спринтами. Кора из реальных встреч видит, движетесь ли вы к цели или только отчитываетесь, что движетесь.',
    detail: ['Старт спринта', 'Мониторинг хода', 'Разбор результата', 'Перенос незакрытого'],
  },
  {
    tag: 'Память',
    title: 'Всё, что наработали — остаётся',
    text: 'Встречи, решения, чаты, отчёты — в одной памяти компании. Уходит человек — знания остаются. Цифровой двойник отвечает как сам человек.',
    detail: ['Второй мозг компании', 'Цифровые двойники', 'Поиск с источником', 'Telegram-доступ'],
  },
];

export default function LandingV2() {
  useEffect(() => {
    const id = 'v2-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => { entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.05 },
    );
    document.querySelectorAll('.v2 .reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="v2">
      <V2Styles />
      <div style={{ background: 'oklch(0.84 0.13 168)', color: '#061008', padding: '8px 24px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textAlign: 'center', position: 'sticky', top: 0, zIndex: 100 }}>
        ВАРИАНТ 2 — Минт / Manrope &nbsp;·&nbsp; <Link href="/preview/v1" style={{ color: '#061008', textDecoration: 'underline' }}>Посмотреть Вариант 1 →</Link>
      </div>

      {/* HEADER */}
      <header className="v2-header">
        <div className="v2-wrap v2-header-inner">
          <Link href="/" className="v2-brand">
            <span className="v2-brand-mark" />
            КОРА
          </Link>
          <nav className="v2-nav">
            <Link href="/login" className="v2-btn v2-btn-ghost">Войти</Link>
            <Link href="/signup" className="v2-btn v2-btn-primary">Получить доступ</Link>
          </nav>
        </div>
      </header>

      <main>
        {/* HERO */}
        <section className="v2-hero">
          <div className="v2-wrap v2-hero-inner">
            <div className="v2-hero-text">
              <div className="v2-chip">
                <span className="v2-chip-dot" />
                AI-операционный директор
              </div>
              <h1>
                Компании растут,<br />
                когда добивают цели.<br />
                <span className="v2-mint">Кора следит,</span><br />
                чтобы точно добивались.
              </h1>
              <p className="v2-hero-sub">
                Встречи, задачи, спринты и память компании — в одном месте.
                Кора слышит всё и видит, где компания теряет движение.
              </p>
              <div className="v2-hero-ctas">
                <Link href="/signup" className="v2-btn v2-btn-primary v2-btn-lg">Получить ранний доступ</Link>
                <Link href="/login" className="v2-btn v2-btn-outline v2-btn-lg">Войти →</Link>
              </div>
            </div>
            <div className="v2-hero-panel">
              <div className="v2-status-panel">
                <div className="v2-panel-label">Сейчас в работе</div>
                <div className="v2-panel-rows">
                  <div className="v2-panel-row"><span className="v2-dot v2-dot-green" />Спринт 14 — 6 задач активны</div>
                  <div className="v2-panel-row"><span className="v2-dot v2-dot-amber" />Обещание клиенту — 2 дня до срока</div>
                  <div className="v2-panel-row"><span className="v2-dot v2-dot-green" />Встреча записана — отчёт готов</div>
                  <div className="v2-panel-row"><span className="v2-dot v2-dot-muted" />Двойник Марины отвечает на вопросы</div>
                </div>
                <div className="v2-panel-foot">
                  <span className="v2-live-dot" />Данные из реальных встреч · прямо сейчас
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SOURCES */}
        <div className="v2-sources-strip reveal">
          <div className="v2-wrap">
            <span className="v2-sources-label">Откуда Кора видит всё</span>
            <div className="v2-sources-pills">
              {['Видеовстречи','Планёрки','Вечерние отчёты','Рабочие чаты','Задачи в трекере','Спринты'].map((s) => (
                <span className="v2-pill" key={s}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        {/* FEATURES */}
        <section className="v2-features">
          <div className="v2-wrap">
            <div className="v2-section-eyebrow reveal">Что внутри</div>
            <h2 className="v2-section-title reveal">Двенадцать инструментов — один <span className="v2-mint">растущий актив</span>.</h2>
            <div className="v2-feature-list">
              {FEATURES.map((f, i) => (
                <div className="v2-feature-row reveal" key={f.tag}>
                  <div className="v2-feature-num">{String(i + 1).padStart(2, '0')}</div>
                  <div className="v2-feature-main">
                    <div className="v2-feature-tag">{f.tag}</div>
                    <h3 className="v2-feature-title">{f.title}</h3>
                    <p className="v2-feature-text">{f.text}</p>
                  </div>
                  <div className="v2-feature-details">
                    {f.detail.map((d) => (
                      <div className="v2-feature-detail-item" key={d}>
                        <span className="v2-check">✓</span>{d}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PAIN */}
        <section className="v2-pain">
          <div className="v2-wrap">
            <div className="v2-pain-head">
              <div className="v2-section-eyebrow reveal">Что меняет Кора</div>
              <h2 className="v2-section-title reveal">Цели ставят все.<br />Добивают — <span className="v2-mint">единицы</span>.</h2>
            </div>
            <div className="v2-pain-grid reveal">
              {PAIN_ITEMS.map(({ n, problem, fix }) => (
                <div className="v2-pain-card" key={n}>
                  <div className="v2-pain-n">{n}</div>
                  <div className="v2-pain-problem">{problem}</div>
                  <div className="v2-pain-arrow">→</div>
                  <div className="v2-pain-fix">{fix}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="v2-how">
          <div className="v2-wrap">
            <div className="v2-section-eyebrow reveal">Как это работает</div>
            <h2 className="v2-section-title reveal">Один недельный цикл,<br />который двигает компанию.</h2>
            <div className="v2-steps reveal">
              {[
                ['Ставите цель','Собираете спринт: что делаем на этой неделе и ради чего. Кора фиксирует.'],
                ['Команда работает','В привычном трекере. Задачи из встреч и чатов появляются сами.'],
                ['Кора видит правду','Слушает встречи, читает чаты — видит, реально ли вы идёте к цели.'],
                ['Разбор спринта','Что добили, что застряло, цель на следующий. Всё в память компании.'],
              ].map(([title, text], i) => (
                <div className="v2-step" key={title}>
                  <div className="v2-step-n">{String(i + 1).padStart(2, '0')}</div>
                  <div className="v2-step-line" />
                  <h4 className="v2-step-title">{title}</h4>
                  <p className="v2-step-text">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* MEMORY BLOCK */}
        <section className="v2-memory">
          <div className="v2-wrap">
            <div className="v2-memory-inner reveal">
              <div className="v2-memory-text">
                <div className="v2-section-eyebrow">Память компании</div>
                <h2 className="v2-memory-title">Уходит человек — память остаётся.</h2>
                <p className="v2-memory-sub">Встречи, решения, переписки — всё копится в одном месте. С каждым днём память компании знает о вас больше. Это актив, который только растёт.</p>
                <div className="v2-memory-points">
                  {[
                    ['Знания не уходят с людьми','Увольнение — не катастрофа. Новый видит историю предшественника.'],
                    ['Цифровые двойники','Спросить эксперта в отпуске или уволенного — ответит так же, как он.'],
                    ['Поиск с источником','«Что решили по клиенту в марте?» — ответ со ссылкой на встречу.'],
                  ].map(([title, text]) => (
                    <div className="v2-memory-point" key={title}>
                      <div className="v2-memory-point-title">{title}</div>
                      <div className="v2-memory-point-text">{text}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="v2-memory-visual">
                <div className="v2-memory-graph">
                  <div className="v2-graph-node v2-graph-node-center">
                    <span className="v2-graph-dot" />
                    <span className="v2-graph-label">Память<br />компании</span>
                  </div>
                  {['Встречи','Задачи','Чаты','Отчёты','Двойники'].map((label, i) => (
                    <div className={`v2-graph-satellite v2-sat-${i}`} key={label}>
                      <span className="v2-graph-sat-dot" />
                      <span className="v2-graph-sat-label">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TESTIMONIALS */}
        <section className="v2-reviews">
          <div className="v2-wrap">
            <div className="v2-section-eyebrow reveal">Отзывы</div>
            <h2 className="v2-section-title reveal">С этого начинался рост<br />у тех, кто уже внутри.</h2>
            <div className="v2-reviews-grid reveal">
              <div className="v2-review v2-review-featured">
                <div className="v2-review-quote">&ldquo;</div>
                <blockquote>Раньше цели на квартал к середине просто растворялись. Теперь каждую неделю — спринт, и на разборе Кора показывает не галочки в трекере, а что реально обсуждали на встречах. За квартал добили два проекта, которые висели с прошлого года.</blockquote>
                <div className="v2-review-metric">Выручка <strong>+23%</strong> за квартал</div>
                <div className="v2-review-author">
                  <strong>Артём Кравцов</strong>
                  <span>основатель digital-агентства · 18 человек · Казань</span>
                </div>
              </div>
              <div className="v2-review-stack">
                <div className="v2-review">
                  <div className="v2-review-quote">&ldquo;</div>
                  <blockquote>Уволился логист, который шесть лет держал всех поставщиков в голове. Новый человек спросил у его цифрового двойника — онбординг вместо полугода занял две недели.</blockquote>
                  <div className="v2-review-author">
                    <strong>Марина Соколова</strong>
                    <span>операционный директор · 40 человек · Екатеринбург</span>
                  </div>
                </div>
                <div className="v2-review">
                  <div className="v2-review-quote">&ldquo;</div>
                  <blockquote>Кора слышит «сделаем к пятнице» прямо на созвоне и ставит задачу сама. Клиенты больше не ловят нас на «вы же обещали».</blockquote>
                  <div className="v2-review-author">
                    <strong>Дмитрий Веров</strong>
                    <span>владелец сети сервисных центров · 25 человек · Новосибирск</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PRIVACY */}
        <div className="v2-privacy reveal">
          <div className="v2-wrap v2-privacy-inner">
            <div className="v2-privacy-icon">§</div>
            <div>
              <h3 className="v2-privacy-title">Ваши данные — только ваши.</h3>
              <p className="v2-privacy-text">Встречи и отчёты хранятся в вашем контуре. Доступ по ролям. Ничего не уходит на сторону и не используется для обучения чужих моделей.</p>
            </div>
          </div>
        </div>

        {/* FINAL CTA */}
        <section className="v2-cta" id="cta">
          <div className="v2-wrap v2-cta-inner">
            <h2 className="v2-cta-title reveal">Поставьте первую цель<br />уже на <span className="v2-mint">этой неделе</span>.</h2>
            <p className="v2-cta-sub reveal">Память, которая помнит за всех, и спринты, которые ведут к результату.</p>
            <div className="v2-cta-btns reveal">
              <Link href="/signup" className="v2-btn v2-btn-primary v2-btn-xl">Получить ранний доступ</Link>
              <Link href="/login" className="v2-btn v2-btn-ghost">Войти →</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="v2-footer">
        <div className="v2-wrap v2-footer-inner">
          <div className="v2-footer-brand">КОРА · ПАМЯТЬ ВАШЕЙ КОМПАНИИ</div>
          <div className="v2-footer-links">
            <Link href="/terms">Договор оферты</Link>
            <Link href="/privacy">Политика конфиденциальности</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function V2Styles() {
  return (
    <style>{`
      .v2 {
        --bg: #080D0A;
        --bg-card: #0F1A14;
        --bg-raised: #162118;
        --ink: #E4F2EC;
        --ink-soft: rgba(228,242,236,0.72);
        --ink-muted: #6E9A84;
        --line: rgba(228,242,236,0.07);
        --line-strong: rgba(228,242,236,0.14);
        --mint: oklch(0.84 0.13 168);
        --mint-soft: oklch(0.84 0.13 168 / 0.08);
        --mint-border: oklch(0.84 0.13 168 / 0.22);
        --sans: 'Manrope', system-ui, sans-serif;
        --container: 1180px;
        --pad: 32px;
        background-color: var(--bg);
        color: var(--ink);
        font-family: var(--sans);
        font-size: 16px;
        line-height: 1.6;
        -webkit-font-smoothing: antialiased;
        overflow-x: hidden;
        min-height: 100vh;
      }
      .v2 * { box-sizing: border-box; margin: 0; padding: 0; }
      .v2 main { background: var(--bg); }
      .v2-wrap { max-width: var(--container); margin: 0 auto; padding: 0 var(--pad); }
      .v2-mint { color: var(--mint); }

      /* HEADER */
      .v2-header { position: sticky; top: 36px; z-index: 50; background: rgba(8,13,10,0.82); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-bottom: 1px solid var(--line); }
      .v2-header-inner { display: flex; align-items: center; justify-content: space-between; height: 64px; }
      .v2-brand { display: inline-flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; letter-spacing: 0.08em; color: var(--ink); text-decoration: none; }
      .v2-brand-mark { width: 8px; height: 8px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 12px oklch(0.84 0.13 168 / 0.5); flex-shrink: 0; }
      .v2-nav { display: flex; gap: 8px; align-items: center; }

      /* BUTTONS */
      .v2-btn { display: inline-flex; align-items: center; justify-content: center; font-family: var(--sans); font-size: 14px; font-weight: 600; padding: 10px 20px; border-radius: 8px; text-decoration: none; transition: all 0.2s; cursor: pointer; border: 1px solid transparent; white-space: nowrap; line-height: 1; letter-spacing: 0.01em; }
      .v2-btn-ghost { color: var(--ink-muted); background: transparent; }
      .v2-btn-ghost:hover { color: var(--ink); }
      .v2-btn-outline { color: var(--ink); border-color: var(--line-strong); background: transparent; }
      .v2-btn-outline:hover { border-color: var(--mint-border); color: var(--mint); }
      .v2-btn-primary { color: #061008; background: var(--mint); font-weight: 700; }
      .v2-btn-primary:hover { background: oklch(0.88 0.13 168); transform: translateY(-1px); box-shadow: 0 8px 24px -8px oklch(0.84 0.13 168 / 0.4); }
      .v2-btn-lg { padding: 14px 28px; font-size: 15px; }
      .v2-btn-xl { padding: 18px 36px; font-size: 16px; }

      /* CHIP */
      .v2-chip { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mint); background: var(--mint-soft); border: 1px solid var(--mint-border); border-radius: 999px; padding: 6px 14px; margin-bottom: 28px; }
      .v2-chip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mint); flex-shrink: 0; animation: v2-pulse 2s ease-out infinite; }
      @keyframes v2-pulse { 0%{box-shadow:0 0 0 0 oklch(0.84 0.13 168 / 0.5)} 70%{box-shadow:0 0 0 8px oklch(0.84 0.13 168 / 0)} 100%{box-shadow:0 0 0 0 oklch(0.84 0.13 168 / 0)} }

      /* HERO */
      .v2-hero { padding: 80px 0 100px; }
      .v2-hero-inner { display: grid; grid-template-columns: 1fr 480px; gap: 80px; align-items: center; }
      .v2-hero-text h1 { font-size: clamp(38px, 5vw, 68px); font-weight: 800; line-height: 1.08; letter-spacing: -0.03em; margin-bottom: 28px; color: var(--ink); }
      .v2-hero-sub { font-size: 18px; color: var(--ink-soft); max-width: 52ch; line-height: 1.6; margin-bottom: 40px; }
      .v2-hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; }

      /* STATUS PANEL */
      .v2-status-panel { background: var(--bg-card); border: 1px solid var(--line-strong); border-radius: 16px; padding: 28px; }
      .v2-panel-label { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-muted); margin-bottom: 20px; }
      .v2-panel-rows { display: flex; flex-direction: column; gap: 14px; margin-bottom: 24px; }
      .v2-panel-row { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--ink-soft); line-height: 1.4; }
      .v2-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
      .v2-dot-green { background: var(--mint); box-shadow: 0 0 8px oklch(0.84 0.13 168 / 0.5); }
      .v2-dot-amber { background: oklch(0.78 0.13 75); }
      .v2-dot-muted { background: var(--line-strong); }
      .v2-panel-foot { font-size: 11px; color: var(--ink-muted); display: flex; align-items: center; gap: 8px; padding-top: 20px; border-top: 1px solid var(--line); }
      .v2-live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mint); flex-shrink: 0; animation: v2-pulse 2s ease-out infinite; }

      /* SOURCES STRIP */
      .v2-sources-strip { padding: 32px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
      .v2-sources-strip .v2-wrap { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
      .v2-sources-label { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-muted); white-space: nowrap; }
      .v2-sources-pills { display: flex; flex-wrap: wrap; gap: 8px; }
      .v2-pill { font-size: 13px; color: var(--ink-soft); background: var(--bg-card); border: 1px solid var(--line-strong); border-radius: 999px; padding: 5px 14px; }

      /* SECTION HEADERS */
      .v2-section-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--mint); margin-bottom: 16px; }
      .v2-section-title { font-size: clamp(28px, 3.5vw, 46px); font-weight: 700; line-height: 1.12; letter-spacing: -0.025em; color: var(--ink); margin-bottom: 56px; max-width: 22ch; }

      /* FEATURES */
      .v2-features { padding: 100px 0; }
      .v2-feature-list { display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--line); }
      .v2-feature-row { display: grid; grid-template-columns: 64px 1fr 240px; gap: 40px; align-items: start; padding: 48px 0; border-bottom: 1px solid var(--line); transition: background 0.2s; }
      .v2-feature-row:hover { background: linear-gradient(90deg, transparent, var(--mint-soft) 40%, transparent); margin: 0 -32px; padding-left: 32px; padding-right: 32px; }
      .v2-feature-num { font-size: 13px; font-weight: 700; color: var(--mint); letter-spacing: 0.06em; padding-top: 4px; }
      .v2-feature-tag { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mint); margin-bottom: 10px; }
      .v2-feature-title { font-size: 22px; font-weight: 700; color: var(--ink); margin-bottom: 12px; letter-spacing: -0.015em; line-height: 1.2; }
      .v2-feature-text { font-size: 15px; color: var(--ink-soft); line-height: 1.65; max-width: 52ch; }
      .v2-feature-details { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
      .v2-feature-detail-item { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--ink-muted); }
      .v2-check { color: var(--mint); font-size: 12px; flex-shrink: 0; font-weight: 700; }

      /* PAIN */
      .v2-pain { padding: 100px 0; background: var(--bg-card); }
      .v2-pain-head { margin-bottom: 56px; }
      .v2-pain-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; background: var(--line); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
      .v2-pain-card { background: var(--bg-card); padding: 32px 28px; display: flex; flex-direction: column; gap: 16px; transition: background 0.2s; }
      .v2-pain-card:hover { background: var(--bg-raised); }
      .v2-pain-n { font-size: 11px; font-weight: 700; color: var(--mint); letter-spacing: 0.1em; }
      .v2-pain-problem { font-size: 15px; color: var(--ink-soft); line-height: 1.5; }
      .v2-pain-arrow { color: var(--mint); font-size: 18px; }
      .v2-pain-fix { font-size: 15px; font-weight: 600; color: var(--ink); line-height: 1.5; }

      /* HOW IT WORKS */
      .v2-how { padding: 100px 0; }
      .v2-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; position: relative; }
      .v2-step { padding: 0 32px 0 0; position: relative; }
      .v2-step-n { font-size: 13px; font-weight: 700; color: var(--mint); letter-spacing: 0.06em; margin-bottom: 16px; }
      .v2-step-line { height: 1px; background: linear-gradient(90deg, var(--mint) 0%, var(--line-strong) 100%); margin-bottom: 20px; }
      .v2-step:last-child .v2-step-line { background: var(--line); }
      .v2-step-title { font-size: 17px; font-weight: 700; color: var(--ink); margin-bottom: 10px; letter-spacing: -0.01em; }
      .v2-step-text { font-size: 14px; color: var(--ink-muted); line-height: 1.6; }

      /* MEMORY */
      .v2-memory { padding: 100px 0; }
      .v2-memory-inner { display: grid; grid-template-columns: 1fr 400px; gap: 80px; align-items: center; }
      .v2-memory-title { font-size: clamp(28px, 3.5vw, 48px); font-weight: 700; line-height: 1.1; letter-spacing: -0.025em; color: var(--ink); margin: 16px 0 20px; }
      .v2-memory-sub { font-size: 16px; color: var(--ink-soft); line-height: 1.65; margin-bottom: 40px; max-width: 52ch; }
      .v2-memory-points { display: flex; flex-direction: column; gap: 24px; }
      .v2-memory-point { padding-top: 20px; border-top: 1px solid var(--line); }
      .v2-memory-point-title { font-size: 15px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }
      .v2-memory-point-text { font-size: 14px; color: var(--ink-muted); line-height: 1.55; }

      /* GRAPH VISUAL */
      .v2-memory-visual { display: flex; align-items: center; justify-content: center; }
      .v2-memory-graph { position: relative; width: 340px; height: 340px; }
      .v2-graph-node-center { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .v2-graph-dot { width: 48px; height: 48px; border-radius: 50%; background: var(--mint-soft); border: 2px solid var(--mint); display: block; box-shadow: 0 0 32px oklch(0.84 0.13 168 / 0.2); }
      .v2-graph-label { font-size: 12px; font-weight: 700; color: var(--mint); text-align: center; line-height: 1.3; letter-spacing: 0.04em; text-transform: uppercase; }
      .v2-graph-satellite { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 6px; }
      .v2-sat-0 { top: 10px; left: 50%; transform: translateX(-50%); }
      .v2-sat-1 { top: 40%; right: 0; transform: translateY(-50%); }
      .v2-sat-2 { bottom: 20px; right: 20%; }
      .v2-sat-3 { bottom: 20px; left: 20%; }
      .v2-sat-4 { top: 40%; left: 0; transform: translateY(-50%); }
      .v2-graph-sat-dot { width: 28px; height: 28px; border-radius: 50%; background: var(--bg-raised); border: 1px solid var(--line-strong); display: block; }
      .v2-graph-sat-label { font-size: 11px; color: var(--ink-muted); font-weight: 600; text-align: center; }

      /* REVIEWS */
      .v2-reviews { padding: 100px 0; }
      .v2-reviews-grid { display: grid; grid-template-columns: 1fr 380px; gap: 24px; }
      .v2-review-stack { display: flex; flex-direction: column; gap: 24px; }
      .v2-review { background: var(--bg-card); border: 1px solid var(--line); border-radius: 16px; padding: 32px; }
      .v2-review-featured { display: flex; flex-direction: column; }
      .v2-review-quote { font-size: 48px; line-height: 0.8; color: var(--mint); margin-bottom: 16px; font-weight: 800; }
      .v2-review blockquote { font-size: 16px; color: var(--ink-soft); line-height: 1.65; flex: 1; margin-bottom: 20px; }
      .v2-review-metric { font-size: 13px; font-weight: 700; color: var(--mint); background: var(--mint-soft); border-radius: 999px; padding: 6px 14px; display: inline-block; margin-bottom: 20px; }
      .v2-review-metric strong { font-size: 15px; }
      .v2-review-author { padding-top: 20px; border-top: 1px solid var(--line); font-size: 13px; }
      .v2-review-author strong { display: block; font-weight: 700; color: var(--ink); margin-bottom: 3px; }
      .v2-review-author span { color: var(--ink-muted); font-size: 12px; }

      /* PRIVACY */
      .v2-privacy { padding: 48px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
      .v2-privacy-inner { display: flex; gap: 40px; align-items: center; }
      .v2-privacy-icon { font-size: 64px; color: var(--mint); opacity: 0.4; font-weight: 800; flex-shrink: 0; line-height: 1; }
      .v2-privacy-title { font-size: 22px; font-weight: 700; color: var(--ink); margin-bottom: 8px; }
      .v2-privacy-text { font-size: 15px; color: var(--ink-muted); max-width: 64ch; line-height: 1.6; }

      /* FINAL CTA */
      .v2-cta { padding: 120px 0; background: var(--bg-card); border-top: 1px solid var(--line); }
      .v2-cta-inner { text-align: center; }
      .v2-cta-title { font-size: clamp(32px, 4.5vw, 60px); font-weight: 800; line-height: 1.1; letter-spacing: -0.03em; color: var(--ink); margin-bottom: 20px; }
      .v2-cta-sub { font-size: 18px; color: var(--ink-soft); max-width: 52ch; margin: 0 auto 44px; line-height: 1.6; }
      .v2-cta-btns { display: inline-flex; align-items: center; gap: 16px; flex-wrap: wrap; justify-content: center; }

      /* FOOTER */
      .v2-footer { border-top: 1px solid var(--line); padding: 40px 0; }
      .v2-footer-inner { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--ink-muted); flex-wrap: wrap; gap: 16px; }
      .v2-footer-brand { font-weight: 700; letter-spacing: 0.06em; font-size: 12px; }
      .v2-footer-links { display: flex; gap: 24px; }
      .v2-footer-links a { color: var(--ink-muted); text-decoration: none; transition: color 0.2s; }
      .v2-footer-links a:hover { color: var(--mint); }

      /* REVEAL */
      .v2 .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.8s cubic-bezier(.2,.6,.2,1), transform 0.8s cubic-bezier(.2,.6,.2,1); }
      .v2 .reveal.in { opacity: 1; transform: none; }

      /* Hero entrance */
      .v2-chip { animation: v2-rise 0.8s cubic-bezier(.2,.6,.2,1) 0.1s both; }
      .v2-hero-text h1 { animation: v2-rise 0.9s cubic-bezier(.2,.6,.2,1) 0.2s both; }
      .v2-hero-sub { animation: v2-rise 0.8s cubic-bezier(.2,.6,.2,1) 0.35s both; }
      .v2-hero-ctas { animation: v2-rise 0.8s cubic-bezier(.2,.6,.2,1) 0.48s both; }
      .v2-hero-panel { animation: v2-rise 0.9s cubic-bezier(.2,.6,.2,1) 0.28s both; }
      @keyframes v2-rise { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }

      /* RESPONSIVE */
      @media (max-width: 1024px) {
        .v2-hero-inner { grid-template-columns: 1fr; gap: 48px; }
        .v2-status-panel { max-width: 480px; }
        .v2-feature-row { grid-template-columns: 48px 1fr; }
        .v2-feature-details { display: none; }
        .v2-memory-inner { grid-template-columns: 1fr; gap: 48px; }
        .v2-memory-visual { display: none; }
        .v2-reviews-grid { grid-template-columns: 1fr; }
        .v2-review-stack { display: grid; grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 768px) {
        .v2 { --pad: 20px; }
        .v2-pain-grid { grid-template-columns: 1fr; }
        .v2-steps { grid-template-columns: repeat(2, 1fr); gap: 32px; }
        .v2-review-stack { grid-template-columns: 1fr; }
        .v2-hero-inner { padding: 40px 0 60px; }
        .v2-hero { padding: 60px 0 80px; }
        .v2-feature-row { grid-template-columns: 1fr; gap: 16px; }
        .v2-feature-num { display: none; }
        .v2-privacy-inner { flex-direction: column; gap: 20px; }
        .v2-privacy-icon { font-size: 40px; }
      }
      @media (max-width: 480px) {
        .v2-steps { grid-template-columns: 1fr; }
        .v2-hero-text h1 { font-size: 36px; }
        .v2-nav .v2-btn-ghost { display: none; }
      }
    `}</style>
  );
}
