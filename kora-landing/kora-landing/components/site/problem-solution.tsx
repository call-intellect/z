import Image from "next/image";
import { Check, X } from "lucide-react";

export type ProblemSolutionData = {
  eyebrow: string;
  /** Заголовок; части в `accent` подсветятся градиентом. */
  headingLead: string;
  headingAccent: string;
  intro: string;
  imageAlt: string;
  /** Базовое имя картинок в /public: `${image}-desktop.png` и `${image}-mobile.png`. */
  image: string;
  painsTitle: string;
  pains: string[];
  gainsTitle: string;
  gains: string[];
};

/**
 * Блок «боль → решение»: шапка с развёрнутым текстом, компактная
 * картинка-иллюстрация и два столбца (боли / как закрываем).
 * Весь текст живой → SEO и чёткость на любом экране.
 */
export function ProblemSolution({ data }: { data: ProblemSolutionData }) {
  return (
    <section className="mx-auto max-w-5xl px-4">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-[var(--kora-blue)]">
          {data.eyebrow}
        </p>
        <h2 className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          {data.headingLead} <span className="text-gradient">{data.headingAccent}</span>
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{data.intro}</p>
      </div>

      <div className="mx-auto mt-10 max-w-3xl">
        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl ring-1 ring-black/5 sm:aspect-[16/9]">
          <Image
            src={`/${data.image}-mobile.png`}
            alt={data.imageAlt}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-cover sm:hidden"
          />
          <Image
            src={`/${data.image}-desktop.png`}
            alt={data.imageAlt}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="hidden object-cover sm:block"
          />
        </div>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-white/60 p-6 backdrop-blur sm:p-8">
          <h3 className="text-xl font-bold text-slate-700">{data.painsTitle}</h3>
          <ul className="mt-5 space-y-3.5">
            {data.pains.map((t) => (
              <li key={t} className="flex gap-3 text-[15px] leading-snug text-slate-600">
                <X className="mt-0.5 size-5 shrink-0 text-rose-400" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="kora-glass rounded-2xl p-6 sm:p-8">
          <h3 className="text-xl font-bold text-[var(--kora-blue)]">{data.gainsTitle}</h3>
          <ul className="mt-5 space-y-3.5">
            {data.gains.map((t) => (
              <li key={t} className="flex gap-3 text-[15px] leading-snug text-slate-700">
                <Check className="mt-0.5 size-5 shrink-0 text-emerald-500" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
