'use client';

/**
 * MobileShell — клиентский viewport-gate (ТЗ 2026-06-11 mobile-cora-exec-manager,
 * Ф1, Б1).
 *
 * Принцип Б1: ниже `md` рендерим МОБИЛЬНОЕ дерево, иначе — десктоп. Рендерится
 * ровно ОДНО дерево (не оба через `hidden md:block`), поэтому нет двойного
 * fetch одних и тех же эндпоинтов и лишнего DOM.
 *
 * Anti-flicker: `useIsMobile` на SSR/первом рендере возвращает `false`, а до
 * mount мы отдаём нейтральный `fallback` (skeleton). После mount показываем
 * фактическое дерево. Это убирает гидратационный скачок десктоп↔мобайл
 * (authenticated-зона, SEO не важен).
 *
 * Для ФУНДАМЕНТА (Ф1) этот компонент используется как gate нижней навигации
 * в `AppShell`: ниже md — `MobileTabBar`, иначе — десктоп-вариант (Tracker
 * BottomNav). Контент разделов (Ф2–Ф6) подключит этот же gate позже.
 */

import { useEffect, useState, type ReactNode } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

interface MobileShellProps {
  /** Дерево для ширины < md. */
  mobile: ReactNode;
  /** Дерево для md+ (существующий десктоп). */
  desktop: ReactNode;
  /**
   * Нейтральный плейсхолдер до mount (по умолчанию `null` — для свопа
   * навигации лишний skeleton не нужен; экраны могут передать skeleton).
   */
  fallback?: ReactNode;
}

export function MobileShell({ mobile, desktop, fallback = null }: MobileShellProps) {
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    setMounted(true);
  }, []);

  // До mount — нейтральный fallback (нет скачка десктоп→мобайл).
  if (!mounted) return <>{fallback}</>;

  return <>{isMobile ? mobile : desktop}</>;
}
