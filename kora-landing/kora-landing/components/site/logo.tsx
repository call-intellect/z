import { cn } from "@/lib/utils";

export function KoraMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("relative inline-flex items-center justify-center", className)}
      aria-hidden
    >
      {/* Зацикленное видео-логотип (тест). Белый фон ролика убираем mix-blend. */}
      <video
        src="/logo-breathe.mp4"
        autoPlay
        loop
        muted
        playsInline
        className="h-full w-full object-contain mix-blend-multiply"
      />
    </span>
  );
}

export function KoraLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <KoraMark className="h-10 w-10" />
      <span className="text-xl font-extrabold tracking-tight text-foreground">
        КОРА
      </span>
    </span>
  );
}
