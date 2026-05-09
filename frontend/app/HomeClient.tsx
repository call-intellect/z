'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';
import { fadeIn, slideUp } from '@/ui/motion';

/**
 * Главная страница.
 *
 * - Если юзер залогинен (даже с mustChangePassword) — редирект на /meetings:
 *   guard в `(authenticated)/layout.tsx` сам отправит на onboarding.
 * - Если нет — мини-лендинг с CTA «Начать бесплатно» (signup) и «Войти».
 *
 * Стилистика: dark-first, mint accent, glass-карточки, motion на появлении.
 */
export function HomeClient() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, router]);

  // Пока проверяем — не показываем лендинг (избегаем мерцания).
  if (isLoading || user) {
    return <div className="min-h-screen bg-bg-base" />;
  }

  return (
    <main className="relative flex min-h-screen flex-col bg-bg-base text-fg-primary">
      {/* Subtle background mesh */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background:
            'radial-gradient(circle at 20% 10%, rgba(94,234,212,0.10), transparent 55%), radial-gradient(circle at 85% 75%, rgba(94,234,212,0.06), transparent 60%)',
        }}
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <Link href="/" className="flex items-center gap-2" aria-label="Z">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-accent font-mono text-base font-bold text-accent-fg shadow-glow-mint">
            Z
          </div>
          <span className="text-xl font-semibold tracking-tight">Z</span>
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
      <section className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12 text-center md:px-10">
        <motion.div
          variants={fadeIn}
          initial="initial"
          animate="animate"
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent-border bg-accent-muted px-3 py-1 text-xs font-medium text-accent backdrop-blur-glass"
        >
          <Sparkles size={12} strokeWidth={1.75} />
          AI-отчёт через 3 минуты после звонка
        </motion.div>

        <motion.h1
          variants={slideUp}
          initial="initial"
          animate="animate"
          className="max-w-3xl text-4xl font-semibold tracking-tight text-fg-primary md:text-5xl"
        >
          Видеовстречи с готовым{' '}
          <span className="text-accent">AI-отчётом</span> под ваш тип встречи
        </motion.h1>

        <motion.p
          variants={slideUp}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.05 }}
          className="mt-5 max-w-2xl text-lg text-fg-secondary"
        >
          Запись, расшифровка, structured-отчёт и follow-up письмо —
          автоматически. 9 типов встреч: продажи, custdev, собеседования,
          stand-up и другие.
        </motion.p>

        <motion.div
          variants={slideUp}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.1 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
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

        <motion.div
          variants={fadeIn}
          initial="initial"
          animate="animate"
          transition={{ delay: 0.2 }}
          className="mt-12 grid w-full max-w-3xl grid-cols-1 gap-3 md:grid-cols-3"
        >
          <FeatureCard
            title="Запись и аудио"
            text="Видео + отдельные дорожки на каждого участника — для качественного AI-анализа."
          />
          <FeatureCard
            title="Отчёт под тип"
            text="Шаблон зависит от типа встречи: задачи, возражения, инсайты, решения."
          />
          <FeatureCard
            title="Гость без регистрации"
            text="Поделитесь ссылкой — гость заходит сразу, без логина и установок."
          />
        </motion.div>
      </section>

      <footer className="relative z-10 px-6 py-6 text-center text-xs text-fg-tertiary">
        Z — AI-видеовстречи на LiveKit.
      </footer>
    </main>
  );
}

function FeatureCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card/60 p-4 text-left backdrop-blur-glass">
      <h3 className="mb-1 text-sm font-medium text-fg-primary">{title}</h3>
      <p className="text-xs leading-relaxed text-fg-secondary">{text}</p>
    </div>
  );
}
