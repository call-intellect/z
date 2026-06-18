import Image from "next/image";
import { CheckCircle2 } from "lucide-react";

const POINTS = [
  "Встречи, задачи и решения собираются в одном месте.",
  "AI следит, чтобы договорённости не терялись.",
  "Руководитель управляет результатом, а не ручным контролем.",
];

/**
 * Финальный блок-итог: что такое КОРА (по первому слайду дека),
 * краткое резюме всей страницы и призыв подключиться.
 */
export function SummaryBlock() {
  return (
    <section className="mx-auto max-w-5xl px-4">
      <div className="kora-glass overflow-hidden rounded-3xl p-8 sm:p-12">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          {/* Текст + призыв */}
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--kora-blue)]">
              Платформа КОРА
            </p>
            <h2 className="mt-3 text-balance text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl">
              Превращает разговоры команды в{" "}
              <span className="text-gradient">выполненные цели</span>
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Договорённости, знания и цели больше не теряются в чатах и головах.
              КОРА собирает всё в одном месте, фиксирует решения и доводит задачи
              до результата — а руководитель управляет, а не тушит пожары.
            </p>

            <ul className="mt-6 space-y-3">
              {POINTS.map((t) => (
                <li key={t} className="flex gap-3 text-[15px] leading-snug text-slate-700">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[var(--kora-blue)]" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Иллюстрация */}
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl ring-1 ring-black/5 sm:aspect-[16/9] lg:aspect-[4/5]">
            <Image
              src="/summary2-mobile.png"
              alt="Платформа КОРА: ядро K и все договорённости под AI-контролем — 98% выполнено"
              fill
              sizes="(max-width: 1024px) 100vw, 512px"
              className="object-cover sm:hidden"
            />
            <Image
              src="/summary2-desktop.png"
              alt="Платформа КОРА: ядро K и все договорённости под AI-контролем — 98% выполнено"
              fill
              sizes="(max-width: 1024px) 100vw, 512px"
              className="hidden object-cover sm:block lg:hidden"
            />
            <Image
              src="/summary2-mobile.png"
              alt="Платформа КОРА: ядро K и все договорённости под AI-контролем — 98% выполнено"
              fill
              sizes="512px"
              className="hidden object-cover lg:block"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
