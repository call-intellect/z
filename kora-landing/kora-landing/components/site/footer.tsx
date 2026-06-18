import { KoraLogo } from "./logo";

export function Footer() {
  return (
    <footer className="mt-8 border-t border-border px-4 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex flex-col items-center gap-3 sm:items-start">
          <KoraLogo />
          <p className="max-w-xs text-center text-sm text-muted-foreground sm:text-left">
            AI операционный директор, который превращает разговоры команды в
            выполненные цели.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground sm:items-end">
          <a
            href="https://t.me/SERGEYMZ80"
            className="hover:text-foreground"
          >
            @SERGEYMZ80
          </a>
          <span className="mt-2 text-xs">
            © {new Date().getFullYear()} КОРА. Прототип Sitekora.
          </span>
        </div>
      </div>
    </footer>
  );
}
