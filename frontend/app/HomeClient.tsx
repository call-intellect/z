'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Sparkles,
  Video,
  FileText,
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
} from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';
import { fadeIn, slideUp } from '@/ui/motion';

/**
 * Главная страница (публичный лендинг).
 *
 * Логика:
 * - Залогинен → редирект на /dashboard (guard в (authenticated)/layout сам
 *   отправит на onboarding при mustChangePassword).
 * - Не залогинен → полный лендинг: hero → встречи → трекер → AI-директор →
 *   мост «копируется во второй мозг» → 6 карточек памяти → финальный CTA.
 *
 * Стилистика: dark-first, mint accent, glass-карточки, motion на появлении.
 * Позиционирование: «второй мозг компании» (12 инструментов работают на одну цель).
 */
export function HomeClient() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, router]);

  // Лендинг публичный — показываем сразу, не ждём auth.
  // Заглушку показываем только когда user точно есть (короткое окно до редиректа),
  // иначе при недоступном бэке `isLoading` зависает в true и был бы «синий экран».
  if (user) {
    return <div className="min-h-screen bg-bg-base" />;
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-bg-base text-fg-primary">
      {/* Global mesh — два мягких mint-пятна на тёмном фоне */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-0"
        style={{
          background:
            'radial-gradient(circle at 18% 8%, rgba(94,234,212,0.12), transparent 55%), radial-gradient(circle at 85% 78%, rgba(94,234,212,0.07), transparent 60%)',
        }}
      />

      {/* Top bar */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5 md:px-10">
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

      {/* Hero */}
      <section className="relative z-10 mx-auto flex max-w-6xl flex-col items-center px-6 pb-24 pt-12 text-center md:px-10 md:pt-20">
        <motion.div
          variants={fadeIn}
          initial="initial"
          animate="animate"
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent-border bg-accent-muted px-3 py-1 text-xs font-medium text-accent backdrop-blur-glass"
        >
          <Sparkles size={12} strokeWidth={1.75} />
          Второй мозг компании
        </motion.div>

        <motion.h1
          variants={slideUp}
          initial="initial"
          animate="animate"
          className="max-w-4xl text-4xl font-semibold tracking-tight text-fg-primary md:text-6xl"
        >
          Видеовстречи, задачи и AI-директор.
          <br className="hidden md:block" />{' '}
          <span className="font-medium italic text-accent">
            Всё сохраняется в память компании.
          </span>
        </motion.h1>

        <motion.p
          variants={slideUp}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.05 }}
          className="mt-6 max-w-2xl text-lg text-fg-secondary"
        >
          Проводите встречи, ставьте задачи, управляйте командой — а Кора
          автоматически собирает всё в одно место и помнит за вас. Уходит
          человек — память остаётся.
        </motion.p>

        <motion.div
          variants={slideUp}
          initial="initial"
          animate="animate"
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

      {/* Section 1 — Видеовстречи */}
      <Section
        eyebrow="01 · Встречи"
        title="Видеовстречи и отчёт по итогам"
        lead="Проводите встречи прямо в Коре. Запись и расшифровка — автоматически. Отчёт под тип встречи готов через минуту после окончания."
      >
        <Card
          icon={<Video size={20} strokeWidth={1.75} />}
          title="Видеовстречи"
          text="Полноценные видеовстречи с экраном и чатом. Гость заходит по ссылке без регистрации. Запись и расшифровка сохраняются сразу."
        />
        <Card
          icon={<FileText size={20} strokeWidth={1.75} />}
          title="Отчёт после каждой встречи"
          text="Под каждый тип встречи свой шаблон: один-на-один, разбор сделки, ретроспектива, собеседование. Структура под задачу — не одна выжимка для всех."
        />
      </Section>

      {/* Section 2 — Задачи и трекер */}
      <Section
        eyebrow="02 · Задачи"
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

      {/* Section 3 — AI-операционный директор (выделенный полноширинный блок) */}
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
              03 · AI-операционный директор
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

      {/* Bridge — большой акцент «копируется во второй мозг» */}
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

      {/* Section 4 — Память компании (6 карточек в 3 колонки) */}
      <Section
        eyebrow="04 · Память"
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
          text="Кора подхватывает контекст из встреч, рабочих чатов, переписок и вечерних отчётов сотрудников — без вашего участия. Не нужно вести базу знаний руками."
        />
        <Card
          icon={<MessageSquare size={20} strokeWidth={1.75} />}
          title="Личный консультант"
          text="«Что мы решили по этому клиенту в марте?» «Почему отказались от поставщика?» — отвечает со ссылкой на источник."
        />
        <Card
          icon={<Send size={20} strokeWidth={1.75} />}
          title="Доступ через Telegram"
          text="Не нужно открывать сайт. Написали в Telegram — получили ответ. Поставили задачу одним сообщением — она появилась у исполнителя."
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
            <span className="text-accent">один актив</span>.
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

/* ---------------- helpers ---------------- */

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
  cols?: 2 | 3;
  children: React.ReactNode;
}) {
  const gridCols = cols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2';
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
