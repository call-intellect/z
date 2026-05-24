'use client';

import { useState } from 'react';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { toast } from '@/ui/shadcn/toast';
import { Chip } from '@/ui/components/shared/Chip';
import { ConfirmDialog } from '@/ui/components/shared/ConfirmDialog';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { Sparkline } from '@/ui/components/shared/Sparkline';
import { StatCard } from '@/ui/components/shared/StatCard';

type Props = {
  themeLabel: string;
};

const SURFACE_TOKENS: Array<{ name: string; cssVar: string }> = [
  { name: 'bg-base', cssVar: '--bg-base' },
  { name: 'bg-elevated', cssVar: '--bg-elevated' },
  { name: 'bg-card', cssVar: '--bg-card' },
  { name: 'bg-surface', cssVar: '--bg-surface' },
  { name: 'bg-subtle', cssVar: '--bg-subtle' },
  { name: 'bg-overlay', cssVar: '--bg-overlay' },
];

const TEXT_TOKENS: Array<{ name: string; cssVar: string }> = [
  { name: 'text-primary', cssVar: '--text-primary' },
  { name: 'text-secondary', cssVar: '--text-secondary' },
  { name: 'text-tertiary', cssVar: '--text-tertiary' },
  { name: 'text-disabled', cssVar: '--text-disabled' },
];

const ACCENT_TOKENS: Array<{ name: string; cssVar: string }> = [
  { name: 'accent', cssVar: '--accent' },
  { name: 'accent-hover', cssVar: '--accent-hover' },
  { name: 'accent-active', cssVar: '--accent-active' },
  { name: 'accent-muted', cssVar: '--accent-muted' },
  { name: 'accent-muted-strong', cssVar: '--accent-muted-strong' },
  { name: 'accent-border', cssVar: '--accent-border' },
];

const CHIP_TOKENS: Array<{ name: string; bg: string; fg: string }> = [
  { name: 'success', bg: '--chip-success-bg', fg: '--chip-success-fg' },
  { name: 'warning', bg: '--chip-warning-bg', fg: '--chip-warning-fg' },
  { name: 'danger', bg: '--chip-danger-bg', fg: '--chip-danger-fg' },
  { name: 'info', bg: '--chip-info-bg', fg: '--chip-info-fg' },
  { name: 'lavender', bg: '--chip-lavender-bg', fg: '--chip-lavender-fg' },
  { name: 'sand', bg: '--chip-sand-bg', fg: '--chip-sand-fg' },
];

const SAMPLE_TREND = [12, 14, 11, 18, 22, 19, 26, 24, 31, 28, 33, 30];

function Swatch({ name, cssVar }: { name: string; cssVar: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-16 w-full rounded-md border border-border-subtle"
        style={{ background: `var(${cssVar})` }}
      />
      <div className="flex flex-col">
        <span className="text-xs font-medium text-fg-primary">{name}</span>
        <span className="text-[11px] text-fg-tertiary">{cssVar}</span>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-bg-card p-6 shadow-card-soft">
      <header className="mb-5">
        <h2 className="text-xl font-semibold text-fg-primary">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-fg-secondary">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function DesignPreviewGallery({ themeLabel }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [destructiveOpen, setDestructiveOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-fg-tertiary">
          Дизайн-эталон
        </span>
        <h1 className="text-4xl font-semibold text-fg-primary">
          Тема: {themeLabel}
        </h1>
        <p className="text-base text-fg-secondary">
          Полная галерея дизайн-токенов и базовых компонентов Z. Используется
          для визуальной верификации палитры, типографики и UX-scaffold.
        </p>
      </header>

      <Section
        title="Палитра — поверхности"
        description="Слои фонов от самого глубокого к самому светлому."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {SURFACE_TOKENS.map((s) => (
            <Swatch key={s.cssVar} {...s} />
          ))}
        </div>
      </Section>

      <Section title="Палитра — текст">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {TEXT_TOKENS.map((t) => (
            <div
              key={t.cssVar}
              className="flex flex-col gap-2 rounded-md bg-bg-base p-4"
            >
              <span
                className="text-2xl font-semibold"
                style={{ color: `var(${t.cssVar})` }}
              >
                Aa
              </span>
              <span className="text-xs font-medium text-fg-primary">{t.name}</span>
              <span className="text-[11px] text-fg-tertiary">{t.cssVar}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Палитра — акцент">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {ACCENT_TOKENS.map((s) => (
            <Swatch key={s.cssVar} {...s} />
          ))}
        </div>
      </Section>

      <Section title="Палитра — chip-токены">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHIP_TOKENS.map((c) => (
            <div
              key={c.name}
              className="flex items-center justify-between gap-4 rounded-md bg-bg-base p-4"
            >
              <div className="flex flex-col">
                <span className="text-xs font-medium text-fg-primary">
                  {c.name}
                </span>
                <span className="text-[11px] text-fg-tertiary">
                  {c.bg} · {c.fg}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="h-10 w-10 rounded-sm"
                  style={{ background: `var(${c.bg})` }}
                />
                <div
                  className="h-10 w-10 rounded-sm"
                  style={{ background: `var(${c.fg})` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Типографика">
        <div className="flex flex-col gap-3">
          <p className="text-4xl text-fg-primary">Заголовок 4xl — 48/52</p>
          <p className="text-3xl text-fg-primary">Заголовок 3xl — 32/36</p>
          <p className="text-2xl text-fg-primary">Заголовок 2xl — 24/28</p>
          <p className="text-xl text-fg-primary">Заголовок xl — 20/26</p>
          <p className="text-lg text-fg-primary">Подзаголовок lg — 17/24</p>
          <p className="text-md text-fg-primary">Основной md — 15/22</p>
          <p className="text-base text-fg-primary">Базовый base — 14/21</p>
          <p className="text-sm text-fg-secondary">Вторичный sm — 13/19</p>
          <p className="text-xs text-fg-tertiary">Капитал xs — 12/16</p>
        </div>
      </Section>

      <Section title="Кнопки">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Сохранить</Button>
          <Button variant="secondary">Отмена</Button>
          <Button variant="outline">Контурная</Button>
          <Button variant="ghost">Прозрачная</Button>
          <Button variant="destructive">Удалить</Button>
          <Button variant="link">Ссылка</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm">Маленькая</Button>
          <Button size="default">Стандартная</Button>
          <Button size="lg">Большая</Button>
          <Button disabled>Отключённая</Button>
        </div>
      </Section>

      <Section title="Chip — статусы">
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant="success">Успех</Chip>
          <Chip variant="warning">Внимание</Chip>
          <Chip variant="danger">Ошибка</Chip>
          <Chip variant="info">Инфо</Chip>
          <Chip variant="lavender">Эксперимент</Chip>
          <Chip variant="sand">Черновик</Chip>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip variant="success" size="sm">
            sm
          </Chip>
          <Chip variant="info" size="md">
            md
          </Chip>
        </div>
      </Section>

      <Section
        title="StatCard"
        description="Бордерлесс KPI с двойной мягкой тенью. variant='dark' — визуальный якорь."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Активные встречи" value="128" delta={{ value: 12 }} />
          <StatCard
            label="Часы записей"
            value="342"
            delta={{ value: -4 }}
            sparkline={SAMPLE_TREND}
            sparklineVariant="line"
          />
          <StatCard
            label="Решения за месяц"
            value="56"
            delta={{ value: 8, label: 'WoW' }}
            sparkline={SAMPLE_TREND}
            sparklineVariant="bar"
          />
          <StatCard
            variant="dark"
            label="Здоровье графа"
            value="92%"
            delta={{ value: 3 }}
            sparkline={SAMPLE_TREND}
          />
        </div>
      </Section>

      <Section title="Sparkline">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-xs text-fg-tertiary">line</span>
            <Sparkline data={SAMPLE_TREND} variant="line" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-fg-tertiary">bar</span>
            <Sparkline data={SAMPLE_TREND} variant="bar" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-fg-tertiary">color: success</span>
            <Sparkline
              data={SAMPLE_TREND}
              variant="line"
              color="var(--success)"
            />
          </div>
        </div>
      </Section>

      <Section title="EmptyState">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <EmptyState
            title="Пока ничего не сохранено"
            description="Когда появятся первые встречи — увидите их здесь."
          />
          <EmptyState
            title="Нет активных задач"
            description="Создайте первую задачу прямо сейчас."
            action={<Button size="sm">Создать задачу</Button>}
          />
        </div>
      </Section>

      <Section title="Форма">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="dp-name">Имя</Label>
            <Input id="dp-name" placeholder="Введите имя" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="dp-email">Электронная почта</Label>
            <Input id="dp-email" type="email" placeholder="you@example.com" />
          </div>
        </div>
      </Section>

      <Section
        title="ConfirmDialog и Toast"
        description="Замена нативным confirm() и оповещения через sonner."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Открыть подтверждение
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDestructiveOpen(true)}
          >
            Открыть удаление
          </Button>
          <Button onClick={() => toast.success('Готово — пример успеха')}>
            Toast: успех
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.error('Что-то пошло не так', {
                description: 'Это пример сообщения об ошибке.',
              })
            }
          >
            Toast: ошибка
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.info('Информационное сообщение')}
          >
            Toast: инфо
          </Button>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Подтвердите действие"
          description="Это пример обычного подтверждения."
          onConfirm={() =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                toast.success('Действие подтверждено');
                resolve();
              }, 600),
            )
          }
        />
        <ConfirmDialog
          open={destructiveOpen}
          onOpenChange={setDestructiveOpen}
          title="Удалить запись?"
          description="Это действие необратимо. Запись будет удалена навсегда."
          destructive
          confirmLabel="Удалить"
          onConfirm={() =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                toast.success('Запись удалена');
                resolve();
              }, 600),
            )
          }
        />
      </Section>
    </div>
  );
}
