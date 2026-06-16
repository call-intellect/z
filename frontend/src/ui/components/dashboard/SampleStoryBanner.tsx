"use client";

import { Sparkles } from "lucide-react";

import { cn } from "@/ui/shadcn/lib/utils";

type Props = {
  className?: string;
};

export function SampleStoryBanner({ className }: Props) {
  return (
    <div
      role="status"
      aria-label="Образец данных"
      className={cn(
        "mb-6 flex items-start gap-3 rounded-xl bg-chip-info-bg p-4 shadow-card-soft",
        className,
      )}
    >
      <div className="mt-0.5 shrink-0 rounded-full bg-chip-info-fg/10 p-2">
        <Sparkles size={16} className="text-chip-info-fg" />
      </div>
      <div className="flex-1 text-sm leading-relaxed text-chip-info-fg">
        <div className="font-medium">Это пример того, как выглядит дашборд</div>
        <p className="mt-1 text-chip-info-fg/85">
          После первой встречи здесь появятся ваши темы, сигналы и открытые
          вопросы. Подключите календарь или проведите встречу через Z — и через
          неделю этот экран наполнится реальными данными вашей команды.
        </p>
      </div>
    </div>
  );
}
