'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Sparkles,
  Video,
  ListChecks,
  Zap,
  Briefcase,
  Eye,
  Brain,
  Users,
  Bot,
  Wand2,
  MessageSquare,
  Send,
  UserMinus,
  KeyRound,
  Hourglass,
  AlertOctagon,
  HeartCrack,
  Compass,
  TrendingDown,
  GitBranch,
  Mic,
  FileText,
  CalendarClock,
  type LucideIcon,
} from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';
import { fadeIn, slideUp } from '@/ui/motion';

/**
 * Главная страница (публичный лендинг КОРА).
 *
 * Структура:
 *   1. Top bar (КОРА wordmark + login/signup)
 *   2. LeakSection — боль: 8 «дыр», через которые утекает выручка.
 *   3. SourcesBridge — мост: откуда Кора это видит (5 источников).
 *   4. Hero — ответ на боль: «второй мозг компании».
 *   5–9. Встречи · Задачи · AI-директор · bridge «копируется во второй мозг» · 6 карточек памяти.
 *   10. Final CTA + footer.
 *
 * Логика:
 *   - Залогинен → редирект на /dashboard (guard в (authenticated)/layout отправит на onboarding если нужно).
 *   - Не залогинен → лендинг. Заглушка отображается ТОЛЬКО под `user` — иначе при недоступном бэке
 *     `isLoading` зависает в true и пользователь видит «синий экран».
 */
export function HomeClient() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, router]);

  // Заглушка только под user (момент до редиректа).
  // Если ждать `isLoading` — при недоступном бэке зависнет «синий экран».
  if (user) {
    return <div className="min-h-screen bg-bg-base" />;
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-bg-base text-fg-primary">
      <KeyframesStyle />

      {/* Mint-сетка-mesh на весь экран */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-0"
        style={{
          background:
            'radial-gradient(circle at 18% 8%, rgba(94,234,212,0.12), transparent 55%), radial-gradient(circle at 85% 78%, rgba(94,234,212,0.07), transparent 60%)',
        }}
      />

      {/* Top bar */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5 md:px-10">
        <Link
          href="/"
          className="group flex items-end gap-1.5"
          aria-label="Кора"
        >
          <span className="text-2xl font-bold tracking-[0.14em] text-fg-primary">
            КОРА
          </span>
          <span className="mb-2 h-1.5 w-1.5 rounded-full bg-accent shadow-glow-mint" />
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Войти</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Создать аккаунт</Link>
          </Button>
        </nav>
      </header>

      {/* Первая секция — БОЛЬ */}
      <LeakSection />

      {/* Мост-1 — откуда Кора это видит */}
      <SourcesBridge />

      {/* Hero — ответ на боль: что такое Кора */}
      <section className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 py-24 text-center md:px-10 md:py-32">
        <motion.div
          variants={fadeIn}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent-border bg-accent-muted px-3 py-1 text-xs font-medium text-accent backdrop-blur-glass"
        >
          <Sparkles size={12} strokeWidth={1.75} />
          Что такое Кора
        </motion.div>

        <motion.h1
          variants={slideUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-100px' }}
          className="max-w-5xl text-4xl font-semibold tracking-tight text-fg-primary md:text-6xl"
        >
          <span className="font-medium italic text-accent">Второй мозг</span>{' '}
          вашей компании. Помнит за всех, видит каждую утечку, освобождает
          вашу голову для главного.
        </motion.h1>

        <motion.p
          variants={slideUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-100px' }}
          transition={{ delay: 0.05 }}
          className="mt-6 max-w-2xl text-lg text-fg-secondary"
        >
          Кора собирает встречи, задачи, переписки и решения в одну память.
          AI-директор берёт операционку на себя — у вас остаётся стратегия.
          Уходит человек — память остаётся.
        </motion.p>

        <motion.div
          variants={slideUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-100px' }}
          transition={{ delay: 0.1 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          <Button asChild size="lg" className="gap-2">
            <Link href="/signup">
              Начать бесплатно
              <ArrowRight size={16} strokeWidth={1.75} />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/login">Войти</Link>
          </Button>
        </motion.div>
      </section>

      {/* Section — Встречи */}
      <Section
        eyebrow="Встречи"
        title="Видеовстречи и отчёт по итогам"
        lead="Запись и расшифровка — автоматически. Отчёт под тип встречи готов через минуту после окончания."
        cols={1}
      >
        <Card
          icon={<Video size={20} strokeWidth={1.75} />}
          title="Видеовстречи с AI-отчётом"
          text="Полноценные видеовстречи с экраном и чатом. Гость по ссылке без регистрации. Запись и расшифровка сохраняются автоматически. Отчёт под каждый тип встречи — один-на-один, разбор сделки, ретроспектива, собеседование. Структура под задачу, не одна выжимка для всех."
        />
      </Section>

      {/* Section — Задачи */}
      <Section
        eyebrow="Задачи"
        title="Современный трекер задач"
        lead="Привычный современный трекер — команда ведёт задачи руками, как обычно. Для людей ничего не меняется. А Кора сверху добавляет контекст и собирает новые задачи из встреч и переписки сама."
      >
        <Card
          icon={<ListChecks size={20} strokeWidth={1.75} />}
          title="Привычный трекер"
          text="Доски, статусы, исполнители, сроки — всё, к чему привыкла команда. Ничего нового учить не нужно. Только теперь каждая задача знает свою историю: где появилась, кто о ней говорил, какие решения с ней связаны."
        />
        <Card
          icon={<Zap size={20} strokeWidth={1.75} />}
          title="Задачи появляются сами"
          text="Кора слышит на встрече: «Иван, сделай к пятнице» — и задача появляется на Иване со сроком. То же из переписки в чатах. Не нужно записывать, никто ничего не забывает."
        />
      </Section>

      {/* AI-директор */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16 md:px-10 md:py-24">
        <motion.div
          variants={fadeIn}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-100px' }}
          className="relative overflow-hidden rounded-2xl border border-accent-border bg-gradient-to-br from-accent-muted via-bg-card to-bg-card p-8 backdrop-blur-glass md:p-14"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -left-20 h-72 w-72 rounded-full bg-accent/10 blur-3xl"
          />
          <div className="relative max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent-border bg-accent-muted-strong px-3 py-1 text-xs font-medium text-accent">
              <Bot size={12} strokeWidth={1.75} />
              AI-операционный директор
            </div>
            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">
              Над всем этим —{' '}
              <span className="font-medium italic text-accent">AI-директор</span>
              , который видит компанию целиком.
            </h2>
            <p className="mt-6 max-w-2xl text-lg text-fg-secondary">
              Кто чем занят, что обещано клиентам, где застряли дела, кому пора
              напомнить. Работает круглосуточно, не уходит в отпуск, ничего не
              забывает.
            </p>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <Card
                icon={<Briefcase size={20} strokeWidth={1.75} />}
                title="Помощник директора"
                text="Раньше операционная картина была в десяти разных местах — Кора собирает её в одну: задачи, обещания, риски, точки внимания."
                tone="elevated"
              />
              <Card
                icon={<Eye size={20} strokeWidth={1.75} />}
                title="Полный контроль над командой"
                text="Вечерние отчёты сотрудников, переписки в рабочих чатах, задачи в трекере, итоги встреч — всё в одной картине. Настоящее положение дел прямо сейчас, без созвонов и докладов."
                tone="elevated"
              />
            </div>
          </div>
        </motion.div>
      </section>

      {/* Bridge — копируется во второй мозг */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20 text-center md:px-10 md:py-28">
        <motion.div
          variants={fadeIn}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-6 inline-flex items-center gap-3 text-xs font-medium uppercase tracking-[0.22em] text-accent"
        >
          <span className="h-px w-10 bg-accent" />
          И самое главное
          <span className="h-px w-10 bg-accent" />
        </motion.div>
        <motion.h2
          variants={slideUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-100px' }}
          className="text-4xl font-semibold tracking-tight md:text-6xl"
        >
          Всё это автоматически{' '}
          <span className="font-medium italic text-accent">
            копируется во второй мозг
          </span>{' '}
          компании.
        </motion.h2>
        <motion.p
          variants={slideUp}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-100px' }}
          transition={{ delay: 0.05 }}
          className="mx-auto mt-6 max-w-2xl text-lg text-fg-secondary"
        >
          Встречи, задачи, решения, переписка — всё попадает в общую память
          компании. С каждым днём она помнит о вас больше. Это ваш актив,
          который только растёт.
        </motion.p>
      </section>

      {/* Память — 6 карточек */}
      <Section
        eyebrow="Память"
        title="Память компании, которая остаётся"
        lead="Шесть инструментов работают на одну цель: компания помнит за вас, накапливает опыт и становится умнее с каждым днём."
        cols={3}
      >
        <Card
          icon={<Brain size={20} strokeWidth={1.75} />}
          title="Второй мозг компании"
          text="Всё разрозненное — в одно место и навсегда. Уходит человек — память остаётся. Актив, который только растёт с каждым днём."
          flagship
        />
        <Card
          icon={<Users size={20} strokeWidth={1.75} />}
          title="Знания не уходят с людьми"
          text="Увольнение — не катастрофа. Новый сотрудник видит, как работал предшественник и почему принимал такие решения."
        />
        <Card
          icon={<Bot size={20} strokeWidth={1.75} />}
          title="Цифровые двойники сотрудников"
          text="С двойником можно разговаривать как с самим человеком: спросить эксперта в отпуске или уже уволенного — ответит так же, как ответил бы он."
        />
        <Card
          icon={<Wand2 size={20} strokeWidth={1.75} />}
          title="Собирает информацию сама"
          text="Кора подхватывает контекст из встреч, рабочих чатов, переписок и вечерних отчётов сотрудников — без вашего участия."
        />
        <Card
          icon={<MessageSquare size={20} strokeWidth={1.75} />}
          title="Личный консультант"
          text="«Что мы решили по этому клиенту в марте?» «Почему отказались от поставщика?» — отвечает со ссылкой на источник."
        />
        <Card
          icon={<Send size={20} strokeWidth={1.75} />}
          title="Доступ через Telegram"
          text="Не нужно открывать сайт. Написали в Telegram — получили ответ. Поставили задачу — она появилась у исполнителя."
        />
      </Section>

      {/* Final CTA */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 pb-24 text-center md:px-10">
        <motion.div
          variants={fadeIn}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true, margin: '-100px' }}
          className="rounded-2xl border border-border-subtle bg-bg-card/60 p-10 backdrop-blur-glass md:p-14"
        >
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Двенадцать инструментов —{' '}
            <span className="font-medium italic text-accent">один актив</span>.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-fg-secondary">
            Память вашей компании, которая накапливается каждый день и
            остаётся, что бы ни случилось.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <Link href="/signup">
                Получить ранний доступ
                <ArrowRight size={16} strokeWidth={1.75} />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Войти</Link>
            </Button>
          </div>
        </motion.div>
      </section>

      <footer className="relative z-10 px-6 py-8 text-center text-xs tracking-[0.14em] text-fg-tertiary">
        КОРА · ПАМЯТЬ ВАШЕЙ КОМПАНИИ
      </footer>
    </main>
  );
}

/* ============================================================
   Секция «Кора найдёт дыры»
   ============================================================ */

type Leak = {
  icon: LucideIcon;
  leak: string;
  fix: string;
};

const LEAKS: Leak[] = [
  {
    icon: AlertOctagon,
    leak: 'Из компании утекает выручка — а где именно течёт, непонятно',
    fix: 'Кора подсвечивает каждую утечку: от обещаний клиентам до знаний, уходящих с людьми',
  },
  {
    icon: Compass,
    leak: 'Утопаешь в операционке — нет времени думать на три хода вперёд',
    fix: 'AI-директор берёт рутину на себя — голова освобождается для стратегии',
  },
  {
    icon: TrendingDown,
    leak: 'Без присмотра команда теряет ритм: задачи зависают, обещания не выполняются',
    fix: 'Кора держит ритм: слышит обещания, подсвечивает что застряло',
  },
  {
    icon: GitBranch,
    leak: 'Микроконфликты и несогласованность тормозят работу — а вы узнаёте последним',
    fix: 'AI-директор видит расхождения по тону встреч и чатов, подсвечивает раньше эскалации',
  },
  {
    icon: KeyRound,
    leak: 'Знания только в вашей голове — команда не помнит, почему сделали так',
    fix: 'Каждое решение в общей памяти, со ссылкой на встречу или переписку',
  },
  {
    icon: UserMinus,
    leak: 'Эксперт ушёл — знания ушли с ним',
    fix: 'Цифровой двойник остаётся, отвечает за человека',
  },
  {
    icon: Hourglass,
    leak: 'Долгий онбординг — новички вязнут на пол-года',
    fix: 'Новичок видит историю отдела за минуту, спрашивает у двойников',
  },
  {
    icon: HeartCrack,
    leak: 'Клиенту обещали — не сделали',
    fix: 'Обещание клиенту = задача в трекере, никто не забывает',
  },
];

function LeakSection() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-12 md:px-10 md:pb-28 md:pt-16">
      {/* Дышащее mint-пятно за блоком */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[60%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/8 blur-3xl"
        style={{ animation: 'breathe-mesh 8s ease-in-out infinite' }}
      />

      <motion.div
        initial="initial"
        animate="animate"
        variants={{
          initial: {},
          animate: { transition: { staggerChildren: 0.1 } },
        }}
      >
        <motion.div
          variants={fadeIn}
          className="mb-8 inline-flex items-center gap-3 text-xs font-medium uppercase tracking-[0.22em] text-accent"
        >
          <span className="h-px w-10 bg-accent" />
          Что Кора видит первым
        </motion.div>

        {/* КОРА — wordmark крупно с пульсирующей mint-«дырой» */}
        <motion.div
          variants={{
            initial: { opacity: 0, filter: 'blur(10px)', y: 12 },
            animate: {
              opacity: 1,
              filter: 'blur(0px)',
              y: 0,
              transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
            },
          }}
          className="flex items-baseline gap-3 md:gap-5"
        >
          <span
            className="text-6xl font-bold leading-none tracking-[0.06em] text-fg-primary md:text-8xl"
            style={{
              textShadow:
                '0 0 32px rgba(94, 234, 212, 0.22), 0 0 80px rgba(94, 234, 212, 0.10)',
            }}
          >
            КОРА
          </span>
          <span
            aria-hidden
            className="relative inline-flex h-3 w-3 shrink-0 md:h-4 md:w-4"
          >
            <span className="absolute inset-0 rounded-full bg-accent shadow-glow-mint" />
            <span
              className="absolute -inset-2 rounded-full bg-accent/20"
              style={{
                animation: 'leak-pulse-accent 2.4s ease-in-out infinite',
              }}
            />
          </span>
        </motion.div>

        {/* Animated accent underline */}
        <motion.div
          variants={{
            initial: { width: 0, opacity: 0 },
            animate: {
              width: '6rem',
              opacity: 1,
              transition: {
                duration: 0.9,
                delay: 0.2,
                ease: [0.16, 1, 0.3, 1],
              },
            },
          }}
          className="mt-3 h-px bg-gradient-to-r from-accent via-accent/60 to-transparent"
        />

        <motion.h2
          variants={slideUp}
          className="mt-6 max-w-4xl text-3xl font-semibold tracking-tight md:text-5xl"
        >
          найдёт дыры, через которые{' '}
          <span className="font-medium italic text-accent">утекает выручка</span>{' '}
          твоей компании.
        </motion.h2>

        <motion.p
          variants={slideUp}
          className="mt-6 max-w-2xl text-lg text-fg-secondary"
        >
          Самые частые точки потерь в командах — и самые дорогие.
        </motion.p>
      </motion.div>

      <div className="mt-14 divide-y divide-border-subtle border-y border-border-subtle">
        {LEAKS.map((leak, i) => (
          <LeakRow key={leak.leak} {...leak} delay={i * 0.06} />
        ))}
      </div>
    </section>
  );
}

function LeakRow({ icon: Icon, leak, fix, delay }: Leak & { delay: number }) {
  return (
    <motion.div
      variants={slideUp}
      initial="initial"
      whileInView="animate"
      viewport={{ once: true, margin: '-50px' }}
      transition={{ delay }}
      className="group relative grid items-center gap-4 px-2 py-7 transition-colors hover:bg-accent-muted/30 md:grid-cols-[auto_1fr_auto_1fr] md:gap-6 md:px-4 md:py-8"
    >
      {/* Иконка-«дыра» — мягкий amber огонёк */}
      <div className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-dashed border-warning/30"
        />
        <span
          aria-hidden
          className="absolute inset-1 rounded-full"
          style={{
            animation: 'leak-pulse 4.5s ease-in-out infinite',
            animationDelay: `${delay}s`,
          }}
        />
        <Icon
          size={20}
          strokeWidth={1.75}
          className="relative z-10 text-warning/85"
        />
      </div>

      {/* Текст «дыры» */}
      <div className="text-base font-medium text-fg-primary md:text-lg">
        {leak}
      </div>

      {/* Shimmer-линия между «дырой» и «решением» */}
      <div className="relative hidden h-px w-16 overflow-hidden md:block">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer-line 2.4s linear infinite',
            animationDelay: `${delay + 0.2}s`,
          }}
        />
      </div>

      {/* Текст «решения» с мягким accent-glow */}
      <div
        className="text-base leading-snug text-accent md:text-lg"
        style={{ textShadow: '0 0 24px rgba(94, 234, 212, 0.15)' }}
      >
        {fix}
      </div>
    </motion.div>
  );
}

/* ============================================================
   Мост-1 — Откуда Кора это видит
   ============================================================ */

const SOURCES: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Mic, label: 'Видеовстречи' },
  { icon: CalendarClock, label: 'Планёрки' },
  { icon: FileText, label: 'Вечерние отчёты' },
  { icon: MessageSquare, label: 'Рабочие чаты' },
  { icon: ListChecks, label: 'Задачи в трекере' },
];

function SourcesBridge() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 pb-10 pt-4 md:px-10 md:pb-16 md:pt-8">
      <motion.div
        variants={fadeIn}
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: '-50px' }}
        className="mb-6 text-center text-xs font-medium uppercase tracking-[0.22em] text-fg-tertiary"
      >
        Откуда Кора это видит
      </motion.div>

      <motion.div
        variants={fadeIn}
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: '-50px' }}
        className="flex flex-wrap items-center justify-center gap-2 md:gap-3"
      >
        {SOURCES.map(({ icon: Icon, label }, i) => (
          <motion.div
            key={label}
            variants={slideUp}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: '-50px' }}
            transition={{ delay: i * 0.08 }}
            className="group inline-flex items-center gap-2 rounded-full border border-border-subtle bg-bg-card/40 px-4 py-2 text-sm text-fg-secondary backdrop-blur-glass transition-all hover:border-accent-border hover:text-accent"
          >
            <Icon
              size={14}
              strokeWidth={1.75}
              className="text-accent transition-transform group-hover:scale-110"
            />
            {label}
          </motion.div>
        ))}
      </motion.div>

      <motion.p
        variants={fadeIn}
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: '-50px' }}
        transition={{ delay: 0.3 }}
        className="mx-auto mt-8 max-w-xl text-center text-sm text-fg-tertiary"
      >
        Все источники складываются в одну картину команды. Двенадцать
        инструментов работают на одну цель — ниже.
      </motion.p>
    </section>
  );
}

/* ============================================================
   Helpers (Section / Card)
   ============================================================ */

function Section({
  eyebrow,
  title,
  lead,
  cols = 2,
  children,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  cols?: 1 | 2 | 3;
  children: React.ReactNode;
}) {
  const gridCols =
    cols === 3
      ? 'md:grid-cols-3'
      : cols === 1
        ? 'md:max-w-3xl md:mx-auto'
        : 'md:grid-cols-2';
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 py-16 md:px-10 md:py-20">
      <motion.div
        variants={slideUp}
        initial="initial"
        whileInView="animate"
        viewport={{ once: true, margin: '-100px' }}
        className="mb-10 max-w-2xl"
      >
        <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-accent">
          {eyebrow}
        </div>
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {title}
        </h2>
        <p className="mt-4 text-fg-secondary">{lead}</p>
      </motion.div>
      <div className={`grid gap-4 ${gridCols}`}>{children}</div>
    </section>
  );
}

function Card({
  icon,
  title,
  text,
  flagship,
  tone = 'default',
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  flagship?: boolean;
  tone?: 'default' | 'elevated';
}) {
  const base =
    tone === 'elevated'
      ? 'bg-bg-elevated/70 border-border-subtle'
      : 'bg-bg-card/60 border-border-subtle';

  return (
    <motion.div
      variants={slideUp}
      initial="initial"
      whileInView="animate"
      viewport={{ once: true, margin: '-50px' }}
      className={`relative rounded-xl border p-6 backdrop-blur-glass transition-shadow hover:shadow-card-raised ${base} ${
        flagship ? 'ring-1 ring-accent/40' : ''
      }`}
    >
      {flagship && (
        <div className="absolute -top-2 right-4 rounded-full border border-accent-border bg-accent-muted-strong px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.15em] text-accent">
          Флагман
        </div>
      )}
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md bg-accent-muted text-accent">
        {icon}
      </div>
      <h3 className="text-lg font-semibold tracking-tight text-fg-primary">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{text}</p>
    </motion.div>
  );
}

/* ============================================================
   Inline keyframes для pulse / shimmer / breathing
   ============================================================ */

function KeyframesStyle() {
  return (
    <style>{`
      @keyframes leak-pulse {
        0%, 100% {
          box-shadow:
            0 0 0 0 rgba(245, 158, 11, 0.12),
            0 0 10px 1px rgba(245, 158, 11, 0.08);
          background: rgba(245, 158, 11, 0.025);
        }
        50% {
          box-shadow:
            0 0 0 5px rgba(245, 158, 11, 0),
            0 0 16px 3px rgba(245, 158, 11, 0.14);
          background: rgba(245, 158, 11, 0.06);
        }
      }
      @keyframes leak-pulse-accent {
        0%, 100% {
          box-shadow: 0 0 0 0 rgba(94, 234, 212, 0.5), 0 0 14px 2px rgba(94, 234, 212, 0.35);
        }
        50% {
          box-shadow: 0 0 0 8px rgba(94, 234, 212, 0), 0 0 22px 4px rgba(94, 234, 212, 0.6);
        }
      }
      @keyframes shimmer-line {
        0%   { background-position: -120% 0; }
        100% { background-position: 220% 0; }
      }
      @keyframes breathe-mesh {
        0%, 100% { opacity: 0.45; transform: translate(-50%, -50%) scale(1); }
        50%      { opacity: 0.85; transform: translate(-50%, -50%) scale(1.12); }
      }
      @media (prefers-reduced-motion: reduce) {
        [style*="leak-pulse"],
        [style*="shimmer-line"],
        [style*="breathe-mesh"] {
          animation: none !important;
        }
      }
    `}</style>
  );
}
