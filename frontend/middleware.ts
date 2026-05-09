import { NextResponse, type NextRequest } from 'next/server';

// Заглушка middleware. Реальная защита маршрутов — Фаза 7.
// Пока пропускаем все запросы без модификаций.
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Исключаем статику и Next-internal — на всё остальное middleware смотрит.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
