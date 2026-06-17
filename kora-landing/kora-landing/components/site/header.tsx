"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { KoraLogo } from "./logo";
import { ButtonLink } from "./button-link";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Договорённости", href: "#communication" },
  { label: "Знания", href: "#knowledge" },
  { label: "Цели", href: "#goals" },
  { label: "Платформа", href: "#summary" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3 sm:pt-4">
      <div
        className={cn(
          "flex w-full max-w-6xl items-center justify-between rounded-2xl px-4 py-2.5 transition-all duration-300 sm:px-5",
          scrolled
            ? "kora-glass"
            : "border border-transparent bg-transparent",
        )}
      >
        <a href="#top" className="shrink-0">
          <KoraLogo />
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ButtonLink
            href="https://t.me/SERGEYMZ80"
            className="h-10 rounded-xl bg-gradient-to-br from-[var(--kora-blue)] to-[var(--kora-violet)] px-4 text-primary-foreground shadow-md shadow-blue-500/25 transition-transform hover:scale-[1.03]"
          >
            Связаться
            <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
