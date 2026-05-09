'use client';

import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme, type Theme } from '@/ui/components/theme/ThemeProvider';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { cn } from '@/ui/shadcn/lib/utils';

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: 'dark', label: 'Тёмная', Icon: Moon },
  { value: 'light', label: 'Светлая', Icon: Sun },
  { value: 'system', label: 'Системная', Icon: Monitor },
];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Внешний вид</CardTitle>
        <CardDescription>
          Тема интерфейса. Выбор сохраняется на этом устройстве.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map(({ value, label, Icon }) => {
            const active = theme === value;
            return (
              <Button
                key={value}
                type="button"
                variant={active ? 'outline' : 'secondary'}
                onClick={() => setTheme(value)}
                className={cn(
                  'gap-2',
                  active && 'border-accent text-accent shadow-glow-mint',
                )}
              >
                <Icon size={16} strokeWidth={1.75} />
                {label}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
