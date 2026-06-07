import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import '@livekit/components-styles';
import { AuthProvider } from '@/contexts/auth-context';
import { PwaInit } from '@/lib/pwa/PwaInit';
import { ThemeProvider } from '@/ui/components/theme/ThemeProvider';
import { Toaster } from '@/ui/shadcn/toast';

export const metadata: Metadata = {
  title: 'Кора — память компании',
  description: 'Память вашей компании. То, что было сказано, решено и сделано — теперь не теряется.',
  applicationName: 'Кора',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Кора',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
      { url: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.svg', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
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
          <AuthProvider>{children}</AuthProvider>
          <Toaster />
          <PwaInit />
        </ThemeProvider>
      </body>
    </html>
  );
}
