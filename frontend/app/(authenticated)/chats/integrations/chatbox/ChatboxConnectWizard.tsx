'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import {
  chatboxApi,
  type ChatboxMemberApi,
  type ChatboxWorkspaceApi,
} from '@/api/chatbox.api';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * Мастер первого подключения ChatBox (ТЗ 2026-06-16).
 *
 *   1. Токен → «Проверить».
 *   2. Воркспейс (один) → «Подключить».
 *   3. Синхронизация сотрудников: синк менеджеров (авто-связка по email) →
 *      таблица сопоставления с предвыбранными действиями (связан / создать).
 *   4. Забрать прошлые чаты за период (бэкафилл) — можно пропустить.
 *
 * После завершения зовёт `onDone()` (родитель перечитывает интеграцию и
 * показывает обычное управление). Мульти-воркспейс — отдельная фаза.
 */

type Step = 1 | 2 | 3 | 4;

/** Действие по строке сопоставления. matched → keep/unlink; unmatched → create/skip. */
type MemberAction = 'keep' | 'unlink' | 'create' | 'skip';

const STEP_TITLES: Record<Step, string> = {
  1: 'Токен',
  2: 'Рабочее пространство',
  3: 'Сотрудники',
  4: 'Прошлые чаты',
};

// Значения — в ДНЯХ (handleBackfill умножает на сутки). 'all' — вся история.
const PERIOD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1', label: 'Последний 1 день' },
  { value: '7', label: 'Последние 7 дней' },
  { value: '30', label: 'Последний 1 месяц' },
  { value: '90', label: 'Последние 3 месяца' },
  { value: '180', label: 'Последние 6 месяцев' },
  { value: '365', label: 'Последний год' },
  { value: 'all', label: 'Вся история' },
];

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** Ключ персиста прогресса визарда (sessionStorage, per-tab). */
export const WIZARD_STORAGE_KEY = 'chatbox-connect-wizard';

type WizardPersisted = {
  step: Step;
  token: string;
  workspaceId: string;
  workspaces: ChatboxWorkspaceApi[] | null;
  members: ChatboxMemberApi[] | null;
  actions: Record<string, MemberAction>;
  period: string;
};

function loadWizardState(): Partial<WizardPersisted> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(sessionStorage.getItem(WIZARD_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function ChatboxConnectWizard({ onDone }: { onDone: () => void }) {
  // Прогресс восстанавливается из sessionStorage — уход со страницы и возврат
  // продолжают с того же шага (а не сбрасывают на ввод токена). Сохраняется
  // эффектом ниже; очищается родителем при завершении.
  const [step, setStep] = useState<Step>(() => loadWizardState().step ?? 1);

  // — шаги 1–2
  const [token, setToken] = useState(() => loadWizardState().token ?? '');
  const [workspaces, setWorkspaces] = useState<ChatboxWorkspaceApi[] | null>(
    () => loadWizardState().workspaces ?? null,
  );
  const [workspaceId, setWorkspaceId] = useState(
    () => loadWizardState().workspaceId ?? '',
  );
  const [checking, setChecking] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // — шаг 3
  const [members, setMembers] = useState<ChatboxMemberApi[] | null>(
    () => loadWizardState().members ?? null,
  );
  const [memberSyncing, setMemberSyncing] = useState(false);
  const [actions, setActions] = useState<Record<string, MemberAction>>(
    () => loadWizardState().actions ?? {},
  );
  const [applyingMembers, setApplyingMembers] = useState(false);

  // — шаг 4
  const [period, setPeriod] = useState(() => loadWizardState().period ?? '90');
  const [backfilling, setBackfilling] = useState(false);

  // Персист прогресса при любом изменении значимого стейта.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        WIZARD_STORAGE_KEY,
        JSON.stringify({ step, token, workspaceId, workspaces, members, actions, period }),
      );
    } catch {
      /* sessionStorage недоступен — не критично */
    }
  }, [step, token, workspaceId, workspaces, members, actions, period]);

  // ─────────────────── шаг 1: токен ───────────────────
  const handleCheck = async () => {
    if (!token.trim()) {
      toast.error('Введите токен');
      return;
    }
    setChecking(true);
    try {
      const res = await chatboxApi.listWorkspaces(token.trim());
      if (res.length === 0) {
        toast.error('В этом аккаунте нет доступных пространств');
        return;
      }
      setWorkspaces(res);
      setWorkspaceId(res[0]!.id);
      setStep(2);
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.code === 'chatbox_token_invalid'
          ? 'Неверный токен'
          : errMessage(e, 'Не удалось проверить токен'),
      );
    } finally {
      setChecking(false);
    }
  };

  // ─────────────────── шаг 2: воркспейс ───────────────────
  const handleConnect = async () => {
    if (!workspaceId) {
      toast.error('Выберите рабочее пространство');
      return;
    }
    setConnecting(true);
    try {
      await chatboxApi.saveIntegration({
        token: token.trim(),
        workspaceId,
        syncMode: 'daily', // период фиксирован: раз в сутки в 00:00
        analysisEnabled: true, // по умолчанию AI-анализ включён (ТЗ 2026-06-16)
      });
      toast.success('Подключено');
      setStep(3);
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось подключить'));
    } finally {
      setConnecting(false);
    }
  };

  // ─────────────────── шаг 3: сотрудники ───────────────────
  const loadMembersAfterSync = async () => {
    setMemberSyncing(true);
    try {
      // Синк менеджеров: бэк сам авто-связывает по email. Затем ждём появления.
      await chatboxApi.sync('managers');
      let list: ChatboxMemberApi[] = [];
      for (let i = 0; i < 8; i += 1) {
        await new Promise((r) => setTimeout(r, 2500));
        list = await chatboxApi.listMembers();
        if (list.length > 0) break;
      }
      setMembers(list);
      // Предвыбор: связанный (по email) → keep; не найден → create.
      const init: Record<string, MemberAction> = {};
      for (const m of list) init[m.id] = m.linkedPerson ? 'keep' : 'create';
      setActions(init);
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось синхронизировать сотрудников'));
    } finally {
      setMemberSyncing(false);
    }
  };

  const handleApplyMembers = async () => {
    if (!members) return;
    setApplyingMembers(true);
    try {
      for (const m of members) {
        const a = actions[m.id];
        if (a === 'create') await chatboxApi.createMemberPerson(m.id);
        else if (a === 'unlink') await chatboxApi.linkMember(m.id, null);
        // keep / skip — ничего не делаем.
      }
      toast.success('Сотрудники сопоставлены');
      setStep(4);
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось сохранить сопоставление'));
    } finally {
      setApplyingMembers(false);
    }
  };

  // ─────────────────── шаг 4: бэкафилл ───────────────────
  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const since =
        period === 'all'
          ? undefined
          : new Date(
              Date.now() - Number(period) * 24 * 60 * 60 * 1000,
            ).toISOString();
      await chatboxApi.sync('chats', since);
      toast.success('Запущен импорт прошлых чатов');
      onDone();
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось запустить импорт'));
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="space-y-5">
      <Stepper current={step} />

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Шаг 1. API-токен Чат бокса</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cbw-token">Токен</Label>
              <Input
                id="cbw-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Вставьте токен"
                autoComplete="off"
              />
            </div>
            <Button onClick={() => void handleCheck()} disabled={checking}>
              {checking && <Loader2 size={14} className="animate-spin" />}
              Проверить токен
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && workspaces && (
        <Card>
          <CardHeader>
            <CardTitle>Шаг 2. Рабочее пространство</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Пространство</Label>
              <Select value={workspaceId} onValueChange={setWorkspaceId} disabled={connecting}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите пространство" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                      {w.role ? ` — ${w.role}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-fg-tertiary">
                Пока подключается один воркспейс. Синхронизация — раз в сутки в 00:00.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)} disabled={connecting}>
                Назад
              </Button>
              <Button onClick={() => void handleConnect()} disabled={connecting || !workspaceId}>
                {connecting && <Loader2 size={14} className="animate-spin" />}
                Подключить
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Шаг 3. Синхронизация сотрудников</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {members === null ? (
              <div className="space-y-3">
                <p className="text-sm text-fg-secondary">
                  Заберём менеджеров из Чат бокса и сопоставим с сотрудниками Коры
                  по email. Совпавших — свяжем, остальных предложим создать.
                </p>
                <Button onClick={() => void loadMembersAfterSync()} disabled={memberSyncing}>
                  {memberSyncing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Users size={14} />
                  )}
                  Синхронизировать сотрудников
                </Button>
              </div>
            ) : members.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-fg-secondary">
                  Менеджеры пока не найдены. Можно пропустить — они подтянутся при
                  следующей синхронизации.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => void loadMembersAfterSync()} disabled={memberSyncing}>
                    {memberSyncing && <Loader2 size={14} className="animate-spin" />}
                    Повторить
                  </Button>
                  <Button onClick={() => setStep(4)}>Пропустить</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-lg border border-border-subtle">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-overlay/50 text-left text-xs text-fg-tertiary">
                      <tr>
                        <th className="px-3 py-2 font-medium">Менеджер Чат бокса</th>
                        <th className="px-3 py-2 font-medium">Статус</th>
                        <th className="px-3 py-2 font-medium">Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => {
                        const matched = !!m.linkedPerson;
                        return (
                          <tr key={m.id} className="border-t border-border-subtle">
                            <td className="px-3 py-2">
                              <div className="font-medium text-fg-primary">
                                {m.name || m.email || 'Без имени'}
                              </div>
                              {m.email && (
                                <div className="text-[11px] text-fg-tertiary">{m.email}</div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {matched ? (
                                <Badge variant="success" className="text-[10px]">
                                  Найден: {m.linkedPerson?.name ?? 'сотрудник'}
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[10px]">
                                  Нет в Коре
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Select
                                value={actions[m.id] ?? (matched ? 'keep' : 'create')}
                                onValueChange={(v) =>
                                  setActions((prev) => ({ ...prev, [m.id]: v as MemberAction }))
                                }
                              >
                                <SelectTrigger className="h-8 w-[180px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {matched ? (
                                    <>
                                      <SelectItem value="keep">Связать</SelectItem>
                                      <SelectItem value="unlink">Не связывать</SelectItem>
                                    </>
                                  ) : (
                                    <>
                                      <SelectItem value="create">Создать в Коре</SelectItem>
                                      <SelectItem value="skip">Не создавать</SelectItem>
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setStep(4)} disabled={applyingMembers}>
                    Пропустить
                  </Button>
                  <Button onClick={() => void handleApplyMembers()} disabled={applyingMembers}>
                    {applyingMembers && <Loader2 size={14} className="animate-spin" />}
                    Применить и далее
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Шаг 4. Забрать прошлые чаты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-fg-secondary">
              Импортировать прошлые переписки, чтобы наполнить память компании.
              Можно пропустить — тогда будут собираться только новые.
            </p>
            <div className="space-y-1.5">
              <Label>Период</Label>
              <Select value={period} onValueChange={setPeriod} disabled={backfilling}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onDone} disabled={backfilling}>
                Пропустить
              </Button>
              <Button onClick={() => void handleBackfill()} disabled={backfilling}>
                {backfilling && <Loader2 size={14} className="animate-spin" />}
                Забрать чаты
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const steps: Step[] = [1, 2, 3, 4];
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
              s < current
                ? 'bg-accent text-white'
                : s === current
                  ? 'bg-accent-muted text-accent-fg'
                  : 'bg-bg-overlay text-fg-tertiary',
            )}
          >
            {s < current ? <Check size={13} /> : s}
          </div>
          <span
            className={cn(
              'text-xs',
              s === current ? 'font-medium text-fg-primary' : 'text-fg-tertiary',
            )}
          >
            {STEP_TITLES[s]}
          </span>
          {i < steps.length - 1 && <div className="h-px w-5 bg-border-subtle" />}
        </div>
      ))}
    </div>
  );
}
