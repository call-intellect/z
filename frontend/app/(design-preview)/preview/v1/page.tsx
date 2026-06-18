"use client";

import Link from "next/link";
import { useEffect } from "react";

const PAIN_ROWS: [string, string][] = [
  [
    "Решили на планёрке — через неделю никто не помнит, к чему шли",
    "Цель живёт в спринте. Кора возвращает к ней каждую неделю.",
  ],
  [
    "Задачи зависают между понедельниками, а вы узнаёте последним",
    "Кора слышит, что застряло — и подсвечивает до того, как сорвётся срок.",
  ],
  [
    "Статусы в трекере зелёные, а движения нет",
    "Кора видит правду из встреч и чатов, а не из галочек.",
  ],
  [
    "Клиенту пообещали — не сделали",
    "Обещание на встрече = задача на исполнителе. Никто не забывает.",
  ],
  [
    "Ключевой человек ушёл — знания ушли с ним",
    "Цифровой двойник остаётся. Новый сотрудник входит в курс за минуту.",
  ],
  [
    "Тонете в операционке, некогда думать на три хода вперёд",
    "AI-директор берёт рутину. Голова освобождается для стратегии.",
  ],
];

export default function LandingV1() {
  useEffect(() => {
    const id = "kl-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,300;1,9..144,400&family=Manrope:wght@300;400;500;600;700&display=swap";
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
    );
    document.querySelectorAll(".kl .reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="kl">
      <V1Styles />
      <div
        style={{
          background: "#D4A574",
          color: "#1a1410",
          padding: "8px 24px",
          fontSize: "12px",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textAlign: "center",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        ВАРИАНТ 1 — Янтарь / Fraunces &nbsp;·&nbsp;{" "}
        <Link
          href="/preview/v2"
          style={{ color: "#1a1410", textDecoration: "underline" }}
        >
          Посмотреть Вариант 2 →
        </Link>
      </div>

      <header>
        <div className="wrap header-inner">
          <Link href="/" className="brand">
            <span className="brand-dot" />
            КОРА
          </Link>
          <nav className="nav">
            <Link href="/login" className="btn btn-ghost">
              Войти
            </Link>
            <Link href="/signup" className="btn btn-primary">
              Получить ранний доступ
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="wrap">
            <div className="eyebrow">
              Память · Спринты · AI-операционный директор
            </div>
            <h1>
              Компании растут, когда добивают цели. <em>Кора</em> следит, чтобы
              точно добивались.
            </h1>
            <p className="lead">
              Ставите цель — идёте спринтами — Кора из реальных встреч, чатов и
              отчётов держит фокус и не даёт сбиться. А всё, что наработали,
              остаётся в памяти компании навсегда.
            </p>
            <div className="hero-ctas">
              <Link href="/signup" className="btn btn-primary btn-lg">
                Получить ранний доступ
              </Link>
              <Link href="/login" className="btn btn-outline btn-lg">
                Войти
              </Link>
            </div>
            <div className="hero-note">
              <span className="pulse" />
              Встречи, задачи, спринты и память компании — в одном месте
            </div>
          </div>
        </section>

        <section id="tools">
          <div className="wrap">
            <div className="section-head reveal">
              <div className="section-num">I — Что внутри</div>
              <div>
                <h2 className="section-title">
                  Двенадцать инструментов — один <em>растущий актив</em>.
                </h2>
                <p className="section-sub">
                  Четыре опоры, на которых стоит Кора. Не набор разрозненных
                  сервисов, а единая система — встречи, задачи и память работают
                  друг на друга.
                </p>
              </div>
            </div>
            <div className="tools-grid reveal">
              {[
                {
                  label: "Встречи",
                  cards: [
                    [
                      "Видеовстречи с AI-отчётом",
                      "Полноценные встречи с экраном и чатом. Гость по ссылке без регистрации. Как Zoom — только с памятью.",
                    ],
                    [
                      "Автозапись и расшифровка",
                      "Сохраняются сами. Ничего не нужно включать вручную.",
                    ],
                    [
                      "Отчёт под тип встречи",
                      "Один-на-один, разбор сделки, ретроспектива, собеседование. Структура под задачу — не одна выжимка на всё.",
                    ],
                  ],
                },
                {
                  label: "Задачи и спринты",
                  cards: [
                    [
                      "Привычный трекер",
                      "Доски, статусы, исполнители, сроки. Команде ничего не нужно учить.",
                    ],
                    [
                      "Задачи появляются сами",
                      "Кора слышит «Иван, сделай к пятнице» — и ставит задачу на Ивана. То же из чатов.",
                    ],
                    [
                      "Спринты с контролем цели",
                      "Недельный ритм. Кора следит, реально ли вы идёте к цели — а не просто двигаете статусы.",
                    ],
                  ],
                },
                {
                  label: "AI-директор",
                  cards: [
                    [
                      "Картина целиком",
                      "Кто чем занят, что обещано, где застряло. Раньше — в десяти местах. Теперь — в одном.",
                    ],
                    [
                      "Обещания на радаре",
                      "Расхождения по встречам и чатам подсвечиваются раньше эскалации.",
                    ],
                    [
                      "Отчёты в одной ленте",
                      "Настоящее положение дел без созвонов и докладов.",
                    ],
                  ],
                },
                {
                  label: "Память",
                  cards: [
                    [
                      "Второй мозг компании",
                      "Всё разрозненное — в одном месте. Навсегда.",
                    ],
                    [
                      "Цифровые двойники",
                      "Спросить эксперта в отпуске или уже уволенного — ответит так же, как он.",
                    ],
                    [
                      "Telegram-доступ",
                      "«Что решили по клиенту в марте?» — ответ со ссылкой на источник, прямо из Telegram.",
                    ],
                  ],
                },
              ].map(({ label, cards }) => (
                <div className="tool-group" key={label}>
                  <div className="tool-group-label">{label}</div>
                  {cards.map(([title, text]) => (
                    <div className="tool-card" key={title}>
                      <h4>{title}</h4>
                      <p>{text}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pain">
          <div className="wrap">
            <div className="section-head reveal">
              <div className="section-num">II — Что меняет Кора</div>
              <div>
                <h2 className="section-title">
                  Цели ставят все. Добивают — <em>единицы</em>.
                </h2>
                <p className="section-sub">
                  Шесть точек, в которых обычно теряется движение компании — и
                  что меняет Кора.
                </p>
              </div>
            </div>
            <div className="pain-list reveal">
              {PAIN_ROWS.map(([problem, solution]) => (
                <div className="pain-row" key={problem}>
                  <div className="pain-problem">{problem}</div>
                  <div className="pain-solution">{solution}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how">
          <div className="wrap">
            <div className="section-head reveal">
              <div className="section-num">III — Как это работает</div>
              <div>
                <h2 className="section-title">
                  Один недельный цикл, который <em>двигает компанию</em> вперёд.
                </h2>
              </div>
            </div>
            <div className="steps reveal">
              {[
                [
                  "01",
                  "Ставите цель",
                  "Собираете спринт: что делаем на этой неделе и ради чего.",
                ],
                [
                  "02",
                  "Команда работает",
                  "В привычном трекере. Задачи из встреч и чатов появляются сами.",
                ],
                [
                  "03",
                  "Кора видит правду",
                  "Слушает встречи, читает чаты и отчёты — и видит, реально ли вы идёте к цели.",
                ],
                [
                  "04",
                  "Разбор спринта",
                  "Что добили, что застряло, цель на следующий. Всё уходит в память компании.",
                ],
              ].map(([num, title, text]) => (
                <div className="step" key={num}>
                  <div className="step-num">{num}</div>
                  <h4>{title}</h4>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            <p className="steps-foot reveal">
              Так каждую неделю. Память накапливается, цели <em>добиваются</em>,
              компания растёт.
            </p>
          </div>
        </section>

        <section style={{ padding: 0 }}>
          <div
            className="wrap sources"
            style={{ border: "none", padding: "56px 0" }}
          >
            <div className="sources-label reveal">Откуда Кора видит всё</div>
            <div className="sources-list reveal">
              {[
                "видеовстречи",
                "планёрки",
                "вечерние отчёты",
                "рабочие чаты",
                "задачи в трекере",
                "спринты",
              ].map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          </div>
        </section>

        <section id="memory">
          <div className="wrap">
            <div className="section-head reveal">
              <div className="section-num">V — Память компании</div>
              <div>
                <h2 className="section-title">
                  Под всем этим — память, <em>которая остаётся</em>.
                </h2>
              </div>
            </div>
            <div className="memory reveal">
              <h3>
                Уходит человек — <em>память остаётся</em>.
              </h3>
              <p className="memory-intro">
                Встречи, решения, спринты, переписки — всё копится в одном
                месте. С каждым днём память компании знает о вас больше. Это
                актив, который только растёт.
              </p>
              <div className="memory-grid">
                {[
                  [
                    "Знания не уходят с людьми",
                    "Увольнение — не катастрофа. Новый сотрудник видит, как работал предшественник и почему принимал такие решения.",
                  ],
                  [
                    "Цифровые двойники",
                    "С двойником можно разговаривать как с самим человеком: спросить эксперта в отпуске или уже уволенного.",
                  ],
                  [
                    "Личный консультант",
                    "Любой вопрос по истории компании — ответ со ссылкой на конкретную встречу или переписку.",
                  ],
                ].map(([title, text]) => (
                  <div className="memory-item" key={title}>
                    <h4>{title}</h4>
                    <p>{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="reviews">
          <div className="wrap">
            <div className="section-head reveal">
              <div className="section-num">VI — Отзывы</div>
              <div>
                <h2 className="section-title">
                  С этого начинался <em>рост</em> у тех, кто уже внутри.
                </h2>
              </div>
            </div>
            <div className="testimonials reveal">
              <div className="testimonial">
                <div className="quote-mark">&ldquo;</div>
                <blockquote>
                  Раньше цели на квартал к середине просто растворялись. Теперь
                  каждую неделю — спринт, и на разборе Кора показывает не
                  галочки в трекере, а что реально обсуждали на встречах. За
                  квартал добили два проекта, которые висели с прошлого года.
                  Выручка +23%.
                </blockquote>
                <div className="author">
                  <strong>Артём Кравцов</strong>
                  <span>
                    основатель digital-агентства · 18 человек · Казань
                  </span>
                </div>
              </div>
              <div className="testimonial">
                <div className="quote-mark">&ldquo;</div>
                <blockquote>
                  У нас уволился логист, который шесть лет держал всех
                  поставщиков в голове. Новый человек спросил у его цифрового
                  двойника — и получил ответы со ссылками на конкретные встречи.
                  Онбординг вместо полугода занял две недели.
                </blockquote>
                <div className="author">
                  <strong>Марина Соколова</strong>
                  <span>
                    операционный директор · оптовая компания · 40 человек ·
                    Екатеринбург
                  </span>
                </div>
              </div>
              <div className="testimonial">
                <div className="quote-mark">&ldquo;</div>
                <blockquote>
                  Кора слышит «сделаем к пятнице» прямо на созвоне и ставит
                  задачу сама. За первый месяц перестали терять обещания —
                  клиенты больше не ловят нас на «вы же обещали».
                </blockquote>
                <div className="author">
                  <strong>Дмитрий Веров</strong>
                  <span>
                    владелец сети сервисных центров · 25 человек · Новосибирск
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section style={{ padding: "60px 0" }}>
          <div className="wrap">
            <div className="privacy-wrap reveal">
              <div className="privacy-mark">§</div>
              <div className="privacy-content">
                <h3>Ваши данные — только ваши.</h3>
                <p>
                  Встречи, чаты и отчёты хранятся в вашем контуре. Доступ — по
                  ролям: каждый видит своё. Ничего не уходит на сторону и не
                  используется для обучения чужих моделей.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="final" id="cta">
          <div className="wrap">
            <h2 className="reveal">
              Поставьте первую цель уже на <em>этой неделе</em>.
            </h2>
            <p className="reveal">
              Память, которая помнит за всех, и спринты, которые ведут к
              результату. Двенадцать инструментов — один растущий актив.
            </p>
            <div className="final-ctas reveal">
              <Link href="/signup" className="btn btn-primary btn-lg">
                Получить ранний доступ
              </Link>
              <Link href="/login" className="btn btn-outline btn-lg">
                Войти
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap footer-inner">
          <div className="footer-brand">КОРА · ПАМЯТЬ ВАШЕЙ КОМПАНИИ</div>
          <div className="footer-links">
            <Link href="/terms">Договор оферты</Link>
            <Link href="/privacy">Политика конфиденциальности</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function V1Styles() {
  return (
    <style>{`
      .kl { --bg:#0C0A08; --bg-elev:#14110D; --ink:#F4ECDC; --ink-soft:rgba(244,236,220,0.78); --ink-muted:#8A8175; --line:rgba(244,236,220,0.08); --line-strong:rgba(244,236,220,0.18); --accent:#D4A574; --accent-soft:rgba(212,165,116,0.12); --serif:'Fraunces',Georgia,serif; --sans:'Manrope',system-ui,sans-serif; --container:1180px; --pad-side:32px; background-color:#0C0A08; color:var(--ink); font-family:var(--sans); font-size:17px; line-height:1.55; -webkit-font-smoothing:antialiased; overflow-x:hidden; min-height:100vh; }
      .kl * { box-sizing:border-box; margin:0; padding:0; }
      .kl main { background-color:#0C0A08; }
      .kl section { background-color:#0C0A08; }
      .kl .wrap { max-width:var(--container); margin:0 auto; padding:0 var(--pad-side); position:relative; z-index:2; }
      .kl header { position:sticky; top:36px; z-index:50; background:rgba(12,10,8,0.78); backdrop-filter:blur(18px) saturate(180%); -webkit-backdrop-filter:blur(18px) saturate(180%); border-bottom:1px solid var(--line); }
      .kl .header-inner { display:flex; align-items:center; justify-content:space-between; height:68px; }
      .kl .brand { font-family:var(--serif); font-weight:500; font-size:22px; letter-spacing:0.04em; color:var(--ink); text-decoration:none; display:inline-flex; align-items:center; }
      .kl .brand-dot { display:inline-block; width:7px; height:7px; background:var(--accent); border-radius:50%; margin-right:10px; flex-shrink:0; box-shadow:0 0 12px var(--accent-soft); }
      .kl .nav { display:flex; gap:8px; align-items:center; }
      .kl .btn { display:inline-flex; align-items:center; justify-content:center; font-family:var(--sans); font-size:14px; font-weight:500; padding:11px 20px; border-radius:999px; text-decoration:none; transition:all 0.25s; cursor:pointer; border:1px solid transparent; white-space:nowrap; line-height:1; }
      .kl .btn-ghost { color:var(--ink-muted); background:transparent; }
      .kl .btn-ghost:hover { color:var(--ink); }
      .kl .btn-outline { color:var(--ink); border-color:var(--line-strong); }
      .kl .btn-outline:hover { border-color:var(--ink-muted); background:rgba(244,236,220,0.03); }
      .kl .btn-primary { color:#1a1410; background:var(--accent); font-weight:600; }
      .kl .btn-primary:hover { background:#E0B488; transform:translateY(-1px); box-shadow:0 8px 24px -8px rgba(212,165,116,0.5); }
      .kl .btn-lg { padding:15px 30px; font-size:15px; }
      .kl .hero { padding:110px 0 100px; position:relative; }
      .kl .eyebrow { font-size:12px; font-weight:600; letter-spacing:0.22em; text-transform:uppercase; color:var(--accent); margin-bottom:36px; display:flex; align-items:center; gap:14px; }
      .kl .eyebrow::before { content:''; width:36px; height:1px; background:var(--accent); flex-shrink:0; }
      .kl .hero h1 { font-family:var(--serif); font-weight:400; font-size:clamp(40px,6.4vw,88px); line-height:1.02; letter-spacing:-0.028em; max-width:16ch; margin-bottom:36px; }
      .kl .hero h1 em { font-style:italic; font-weight:300; color:var(--accent); }
      .kl .hero .lead { font-size:clamp(17px,1.35vw,20px); line-height:1.5; max-width:58ch; color:var(--ink-soft); margin-bottom:44px; }
      .kl .hero-ctas { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:28px; }
      .kl .hero-note { font-size:13px; color:var(--ink-muted); letter-spacing:0.04em; display:flex; align-items:center; gap:8px; }
      .kl .pulse { width:8px; height:8px; border-radius:50%; background:var(--accent); display:inline-block; flex-shrink:0; animation:kl-pulse 2.2s ease-out infinite; }
      @keyframes kl-pulse { 0%{box-shadow:0 0 0 0 rgba(212,165,116,0.5)} 70%{box-shadow:0 0 0 12px rgba(212,165,116,0)} 100%{box-shadow:0 0 0 0 rgba(212,165,116,0)} }
      .kl section { padding:100px 0; position:relative; }
      .kl .section-head { display:grid; grid-template-columns:130px 1fr; gap:40px; align-items:start; margin-bottom:64px; }
      .kl .section-num { font-family:var(--serif); font-style:italic; font-size:14px; font-weight:400; letter-spacing:0.16em; color:var(--ink-muted); padding-top:16px; border-top:1px solid var(--line-strong); }
      .kl .section-title { font-family:var(--serif); font-weight:400; font-size:clamp(28px,3.8vw,50px); line-height:1.08; letter-spacing:-0.022em; max-width:22ch; }
      .kl .section-title em { font-style:italic; font-weight:300; color:var(--accent); }
      .kl .section-sub { font-size:16px; color:var(--ink-muted); margin-top:18px; max-width:58ch; line-height:1.55; }
      .kl .tools-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:24px; }
      .kl .tool-group { display:flex; flex-direction:column; gap:14px; }
      .kl .tool-group-label { font-family:var(--serif); font-size:22px; font-style:italic; color:var(--accent); margin-bottom:6px; font-weight:400; }
      .kl .tool-card { border:1px solid var(--line); border-radius:14px; padding:22px; background:linear-gradient(180deg,rgba(244,236,220,0.018) 0%,transparent 100%); transition:all 0.3s ease; flex:1; display:flex; flex-direction:column; min-height:152px; }
      .kl .tool-card:hover { border-color:var(--line-strong); transform:translateY(-2px); }
      .kl .tool-card h4 { font-size:15.5px; font-weight:600; margin-bottom:8px; line-height:1.3; color:var(--ink); }
      .kl .tool-card p { font-size:13.5px; color:var(--ink-muted); line-height:1.55; }
      .kl .pain-list { border-top:1px solid var(--line); }
      .kl .pain-row { display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid var(--line); transition:background 0.2s ease; }
      .kl .pain-row:hover { background:linear-gradient(90deg,transparent 0%,rgba(212,165,116,0.025) 50%,transparent 100%); }
      .kl .pain-problem,.kl .pain-solution { padding:26px 0; font-size:17px; line-height:1.5; }
      .kl .pain-problem { padding-right:48px; color:var(--ink-soft); }
      .kl .pain-solution { padding-left:48px; border-left:1px solid var(--line); font-weight:500; color:var(--ink); }
      .kl .pain-solution::before { content:'→'; color:var(--accent); margin-right:14px; font-weight:400; }
      .kl .steps { display:grid; grid-template-columns:repeat(4,1fr); gap:28px; }
      .kl .step { border-top:1px solid var(--line-strong); padding-top:24px; }
      .kl .step-num { font-family:var(--serif); font-style:italic; font-size:64px; font-weight:300; line-height:1; color:var(--accent); margin-bottom:22px; letter-spacing:-0.04em; }
      .kl .step h4 { font-size:16px; font-weight:600; margin-bottom:10px; color:var(--ink); }
      .kl .step p { font-size:14px; color:var(--ink-muted); line-height:1.55; }
      .kl .steps-foot { margin-top:64px; font-family:var(--serif); font-style:italic; font-size:clamp(20px,2vw,26px); color:var(--ink-muted); text-align:center; max-width:50ch; margin-left:auto; margin-right:auto; line-height:1.35; }
      .kl .steps-foot em { color:var(--ink); }
      .kl .sources { padding:56px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); text-align:center; }
      .kl .sources-label { font-size:12px; letter-spacing:0.22em; text-transform:uppercase; color:var(--ink-muted); margin-bottom:28px; font-weight:600; }
      .kl .sources-list { display:flex; flex-wrap:wrap; justify-content:center; align-items:baseline; gap:0 36px; font-family:var(--serif); font-style:italic; font-size:clamp(18px,1.6vw,24px); color:var(--ink); }
      .kl .sources-list span:not(:last-child)::after { content:'·'; margin-left:36px; color:var(--accent); font-style:normal; }
      .kl .memory { background:radial-gradient(ellipse at top left,rgba(212,165,116,0.06) 0%,transparent 55%),linear-gradient(180deg,rgba(244,236,220,0.015) 0%,transparent 100%); border-radius:24px; padding:80px 64px; border:1px solid var(--line); }
      .kl .memory h3 { font-family:var(--serif); font-size:clamp(32px,4.2vw,58px); font-weight:400; line-height:1.05; letter-spacing:-0.025em; max-width:18ch; margin-bottom:26px; color:var(--ink); }
      .kl .memory h3 em { font-style:italic; color:var(--accent); font-weight:300; }
      .kl .memory-intro { font-size:18px; max-width:58ch; color:var(--ink-soft); margin-bottom:56px; line-height:1.55; }
      .kl .memory-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:36px; }
      .kl .memory-item { border-top:1px solid var(--line-strong); padding-top:24px; }
      .kl .memory-item h4 { font-family:var(--serif); font-size:22px; font-weight:500; margin-bottom:12px; color:var(--ink); }
      .kl .memory-item p { font-size:14.5px; color:var(--ink-muted); line-height:1.55; }
      .kl .testimonials { display:grid; grid-template-columns:repeat(3,1fr); gap:24px; }
      .kl .testimonial { border:1px solid var(--line); border-radius:16px; padding:32px 30px 28px; display:flex; flex-direction:column; background:linear-gradient(180deg,rgba(244,236,220,0.022) 0%,transparent 100%); transition:all 0.3s ease; }
      .kl .testimonial:hover { border-color:var(--line-strong); transform:translateY(-3px); }
      .kl .quote-mark { font-family:var(--serif); font-size:64px; line-height:0.6; color:var(--accent); margin-bottom:18px; font-weight:400; font-style:italic; height:32px; }
      .kl .testimonial blockquote { font-family:var(--serif); font-size:16.5px; line-height:1.5; color:var(--ink); margin-bottom:28px; flex:1; font-style:italic; }
      .kl .author { padding-top:22px; border-top:1px solid var(--line); font-size:13px; line-height:1.5; }
      .kl .author strong { display:block; font-weight:600; color:var(--ink); margin-bottom:4px; font-size:13.5px; }
      .kl .author span { color:var(--ink-muted); }
      .kl .privacy-wrap { display:grid; grid-template-columns:200px 1fr; gap:48px; align-items:center; padding:64px 0; }
      .kl .privacy-mark { font-family:var(--serif); font-size:140px; font-style:italic; font-weight:300; color:var(--accent); line-height:0.7; opacity:0.55; text-align:center; }
      .kl .privacy-content h3 { font-family:var(--serif); font-size:clamp(28px,3.4vw,42px); font-weight:400; line-height:1.1; letter-spacing:-0.02em; margin-bottom:20px; color:var(--ink); }
      .kl .privacy-content p { font-size:16.5px; color:var(--ink-muted); max-width:60ch; line-height:1.6; }
      .kl .final { text-align:center; padding:130px 0 110px; border-top:1px solid var(--line); position:relative; }
      .kl .final::before { content:''; position:absolute; top:-1px; left:50%; transform:translateX(-50%); width:80px; height:1px; background:var(--accent); }
      .kl .final h2 { font-family:var(--serif); font-size:clamp(36px,5.4vw,68px); font-weight:400; line-height:1.04; letter-spacing:-0.028em; margin-bottom:26px; max-width:18ch; margin-left:auto; margin-right:auto; color:var(--ink); }
      .kl .final h2 em { font-style:italic; font-weight:300; color:var(--accent); }
      .kl .final > .wrap > p { font-size:18px; color:var(--ink-muted); max-width:52ch; margin:0 auto 44px; line-height:1.55; }
      .kl .final-ctas { display:inline-flex; gap:12px; }
      .kl footer { border-top:1px solid var(--line); padding:40px 0; }
      .kl .footer-inner { display:flex; align-items:center; justify-content:space-between; font-size:13px; color:var(--ink-muted); letter-spacing:0.04em; flex-wrap:wrap; gap:16px; }
      .kl .footer-brand { font-family:var(--serif); font-style:italic; letter-spacing:0.06em; }
      .kl .footer-links { display:flex; gap:24px; }
      .kl .footer-links a { color:var(--ink-muted); text-decoration:none; transition:color 0.2s; }
      .kl .footer-links a:hover { color:var(--ink); }
      .kl .reveal { opacity:0; transform:translateY(28px); transition:opacity 0.9s cubic-bezier(.2,.6,.2,1),transform 0.9s cubic-bezier(.2,.6,.2,1); }
      .kl .reveal.in { opacity:1; transform:none; }
      .kl .hero .eyebrow { animation:kl-rise 0.9s cubic-bezier(.2,.6,.2,1) 0.1s both; }
      .kl .hero h1 { animation:kl-rise 1s cubic-bezier(.2,.6,.2,1) 0.22s both; }
      .kl .hero .lead { animation:kl-rise 0.9s cubic-bezier(.2,.6,.2,1) 0.42s both; }
      .kl .hero .hero-ctas { animation:kl-rise 0.9s cubic-bezier(.2,.6,.2,1) 0.58s both; }
      .kl .hero .hero-note { animation:kl-rise 0.9s cubic-bezier(.2,.6,.2,1) 0.72s both; }
      @keyframes kl-rise { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:none} }
      @media (max-width:1024px) { .kl .tools-grid{grid-template-columns:repeat(2,1fr)} .kl .steps{grid-template-columns:repeat(2,1fr)} }
      @media (max-width:820px) { .kl .testimonials{grid-template-columns:1fr} .kl .memory-grid{grid-template-columns:1fr;gap:28px} .kl .privacy-wrap{grid-template-columns:1fr;gap:24px;text-align:center} .kl .privacy-mark{font-size:88px} .kl .section-head{grid-template-columns:1fr;gap:16px} .kl .pain-row{grid-template-columns:1fr} .kl .pain-problem{padding-right:0;padding-bottom:6px} .kl .pain-solution{padding-left:0;padding-top:6px;border-left:none} .kl .memory{padding:56px 32px} }
      @media (max-width:580px) { .kl{--pad-side:20px} .kl .tools-grid{grid-template-columns:1fr} .kl .steps{grid-template-columns:1fr} .kl .hero{padding:70px 0 60px} .kl section{padding:70px 0} .kl .sources-list{gap:14px 22px;font-size:17px} .kl .header-inner{height:60px} .kl .btn{padding:10px 16px;font-size:13.5px} .kl .btn-lg{padding:13px 22px;font-size:14px} .kl .nav .btn-ghost{display:none} }
    `}</style>
  );
}
