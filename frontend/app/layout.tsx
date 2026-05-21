import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import '@livekit/components-styles';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import { AuthProvider } from '@/contexts/auth-context';
import { ToastProvider } from '@/contexts/toast-context';
import { ThemeProvider } from '@/ui/components/theme/ThemeProvider';
import { Toaster } from '@/ui/shadcn/toast';

export const metadata: Metadata = {
  title: 'Z — AI-встречи',
  description: 'Видеовстречи с AI-отчётом под тип встречи.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0A0E14',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning — браузерные расширения (LanguageTool/Grammarly и т.п.)
    // дописывают атрибуты в <html>/<body> ДО гидрации React (напр. data-lt-installed),
    // вызывая ложный hydration-mismatch. Подавляем его на этих двух тегах (1 уровень).
    <html
      lang="ru"
      data-theme="dark"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className={GeistSans.className} suppressHydrationWarning>
        <ThemeProvider>
          <AuthProvider>
            {/*
              ToastProvider — legacy notifications context. TODO(M5): убрать
              после миграции всех вызовов на sonner-`toast` из @/ui/shadcn/toast.
            */}
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
