'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CloudUpload,
  FileText,
  Loader2,
  Map as MapIcon,
  RefreshCcw,
  Users,
} from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { documentsApi } from '@/api/documents.api';
import {
  personsDomainApi,
  roleProfilesApi,
  rolesDomainApi,
  type PersonDomainApi,
  type RoleDomainApi,
  type RoleProfileApi,
  type RoleProfileBuildStatusApi,
} from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Skeleton } from '@/ui/shadcn/skeleton';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from '@app/(admin)/admin/AdminStateViews';

const BLOCK_TITLES: Record<string, string> = {
  responsibilities: 'Обязанности',
  skills: 'Навыки',
  decision_patterns: 'Решения, которые принимает',
  common_pitfalls: 'Типичные грабли',
  style_profile: 'Стиль работы',
};

const REBUILD_COOLDOWN_MS = 60_000;
const BUILD_STATUS_POLL_MS = 10_000;

export function RoleDetailClient({ roleId }: { roleId: string }) {
  const { currentOrgId, currentOrgRole, isLoading } = useAuth();
  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках Org."
      />
    );
  }
  const canEdit = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  return <Content orgId={currentOrgId} roleId={roleId} canEdit={canEdit} />;
}

function Content({
  orgId,
  roleId,
  canEdit,
}: {
  orgId: string;
  roleId: string;
  canEdit: boolean;
}) {
  const roleSwr = useSWR(['role', orgId, roleId], () =>
    rolesDomainApi.byId(orgId, roleId),
  );
  const personsSwr = useSWR(['role-persons', orgId, roleId], () =>
    personsDomainApi.list(orgId, { roleId }),
  );
  const profileSwr = useSWR(['role-profile', orgId, roleId], () =>
    roleProfilesApi.byRole(orgId, roleId),
  );

  if (roleSwr.isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="mt-3 h-4 w-1/4" />
      </div>
    );
  }

  if (roleSwr.error) {
    if (roleSwr.error instanceof ApiError && roleSwr.error.code === 'http_404') {
      return (
        <div className="mx-auto w-full max-w-5xl px-6 py-8">
          <AdminEmpty
            title="Раздел в разработке"
            description="API должностей ещё не подключён."
          />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <AdminError
          message={
            roleSwr.error instanceof Error
              ? roleSwr.error.message
              : 'Ошибка загрузки'
          }
          onRetry={() => void roleSwr.mutate()}
        />
      </div>
    );
  }

  const role = roleSwr.data?.role;
  if (!role) return null;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <Link
        href="/roles"
        className="mb-3 inline-flex items-center gap-1 text-xs text-fg-tertiary hover:text-fg-secondary"
      >
        <ArrowLeft size={12} /> К списку должностей
      </Link>

      <Header role={role} />

      <PersonsSection
        persons={personsSwr.data?.items ?? []}
        loading={personsSwr.isLoading}
        canEdit={canEdit}
        orgId={orgId}
        onChanged={() => {
          void personsSwr.mutate();
          void roleSwr.mutate();
        }}
      />

      <JobDescriptionSection
        role={role}
        canEdit={canEdit}
        orgId={orgId}
        onUploaded={() => {
          void profileSwr.mutate();
          void roleSwr.mutate();
        }}
      />

      <RoleProfileSection
        orgId={orgId}
        roleId={roleId}
        profile={profileSwr.data ?? null}
        loading={profileSwr.isLoading}
        error={profileSwr.error}
        canEdit={canEdit}
        onRebuilt={() => void profileSwr.mutate()}
      />
    </div>
  );
}

function Header({ role }: { role: RoleDomainApi }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          {role.name}
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          {role.departmentName ? `Отдел: ${role.departmentName}` : 'Без отдела'}
        </p>
      </div>
      <Link
        href={`/roles/${role.id}/map`}
        className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-card px-3 py-1.5 text-xs font-medium text-fg-primary hover:bg-bg-hover"
      >
        <MapIcon size={14} />
        Карта должности
      </Link>
    </header>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-lg border border-border-subtle bg-bg-card p-5">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-medium text-fg-primary">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function PersonsSection({
  persons,
  loading,
  canEdit,
  orgId,
  onChanged,
}: {
  persons: PersonDomainApi[];
  loading: boolean;
  canEdit: boolean;
  orgId: string;
  onChanged: () => void;
}) {
  const unassign = async (person: PersonDomainApi) => {
    try {
      await personsDomainApi.update(orgId, person.id, { roleId: null });
      toast.success('Сотрудник снят с должности.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить.');
    }
  };
  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Users size={16} /> Назначенные сотрудники
          {!loading && (
            <Badge variant="secondary" className="ml-1">
              {persons.length}
            </Badge>
          )}
        </span>
      }
    >
      {loading ? (
        <Skeleton className="h-8 w-full" />
      ) : persons.length === 0 ? (
        <p className="text-sm text-fg-tertiary">
          На эту должность пока никого не назначено.
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {persons.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between py-2 text-sm"
            >
              <div>
                <div className="font-medium text-fg-primary">{p.fullName}</div>
                {p.email && (
                  <div className="text-xs text-fg-tertiary">{p.email}</div>
                )}
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void unassign(p)}
                >
                  Снять с должности
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function JobDescriptionSection({
  role,
  canEdit,
  orgId,
  onUploaded,
}: {
  role: RoleDomainApi;
  canEdit: boolean;
  orgId: string;
  onUploaded: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleUpload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await documentsApi.upload(orgId, {
        file,
        attachedRoleId: role.id,
      });
      toast.success('Должностная инструкция загружена.');
      setDialogOpen(false);
      setFile(null);
      onUploaded();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось загрузить.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <FileText size={16} /> Должностная инструкция
        </span>
      }
      action={
        canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>
            <CloudUpload size={14} className="mr-1" />
            {role.hasJobDescription ? 'Заменить' : 'Загрузить'}
          </Button>
        )
      }
    >
      {role.hasJobDescription ? (
        <p className="text-sm text-fg-secondary">
          Файл загружен и попадёт в карту должности после парсинга. Превью
          parsedText появится в разделе «Документы».
        </p>
      ) : (
        <p className="text-sm text-fg-tertiary">
          Инструкция ещё не загружена. AI начнёт собирать карту из встреч и
          дампов, но с документом получится точнее.
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Должностная инструкция: «{role.name}»</DialogTitle>
          </DialogHeader>
          <label
            htmlFor="jd-detail-upload"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-sm transition-colors ${
              dragOver
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle text-fg-tertiary hover:border-accent/60 hover:text-fg-secondary'
            }`}
          >
            <CloudUpload size={16} />
            {file
              ? `Выбран файл: ${file.name}`
              : 'Перетащите файл или нажмите, чтобы выбрать'}
            <input
              id="jd-detail-upload"
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.rtf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={busy}
            >
              Отмена
            </Button>
            <Button onClick={() => void handleUpload()} disabled={!file || busy}>
              {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
              Загрузить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function RoleProfileSection({
  orgId,
  roleId,
  profile,
  loading,
  error,
  canEdit,
  onRebuilt,
}: {
  orgId: string;
  roleId: string;
  profile: RoleProfileApi | null;
  loading: boolean;
  error: unknown;
  canEdit: boolean;
  onRebuilt: () => void;
}) {
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [buildStatus, setBuildStatus] =
    useState<RoleProfileBuildStatusApi | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollTimerRef = useRef<number | null>(null);

  // Тикер для секунд cooldown.
  useEffect(() => {
    if (!cooldownUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  useEffect(() => {
    if (cooldownUntil && now >= cooldownUntil) {
      setCooldownUntil(null);
    }
  }, [now, cooldownUntil]);

  // Polling build-status пока активный.
  useEffect(() => {
    if (!buildStatus || buildStatus.status === 'idle') {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    if (pollTimerRef.current) return;
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const s = await roleProfilesApi.buildStatus(orgId, roleId);
        setBuildStatus(s);
        if (s.status === 'idle') {
          onRebuilt();
        }
      } catch {
        // ignore — продолжим polling
      }
    }, BUILD_STATUS_POLL_MS);
    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [buildStatus, orgId, roleId, onRebuilt]);

  const handleRebuild = async () => {
    setCooldownUntil(Date.now() + REBUILD_COOLDOWN_MS);
    try {
      await roleProfilesApi.rebuild(orgId, roleId);
      setBuildStatus({ status: 'queued' });
      toast.success('Пересборка карты должности запущена.');
      onRebuilt();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'http_409' || e.code === 'conflict')) {
        // Уже собирается — узнаём с какого момента.
        try {
          const s = await roleProfilesApi.buildStatus(orgId, roleId);
          setBuildStatus(s);
        } catch {
          setBuildStatus({ status: 'queued' });
        }
        toast('Карта уже собирается. Дождитесь окончания.');
        return;
      }
      toast.error(e instanceof ApiError
            ? e.message
            : 'Не удалось запустить пересборку.');
    }
  };

  const isApiMissing =
    error instanceof ApiError && error.code === 'http_404';

  const inBuild = Boolean(buildStatus && buildStatus.status !== 'idle');
  const cooldownLeftSec = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
    : 0;
  const rebuildDisabled = inBuild || cooldownLeftSec > 0 || !canEdit;

  const buttonLabel = inBuild
    ? buildStatus?.since
      ? `Карта уже собирается с ${formatTime(buildStatus.since)}`
      : 'Карта уже собирается'
    : cooldownLeftSec > 0
      ? `Можно повторить через ${cooldownLeftSec} с`
      : 'Пересобрать карту';

  return (
    <Section
      title="Карта должности"
      action={
        canEdit && (
          <Button
            size="sm"
            variant="outline"
            disabled={rebuildDisabled}
            onClick={() => void handleRebuild()}
          >
            {inBuild ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <RefreshCcw size={14} className="mr-1" />
            )}
            {buttonLabel}
          </Button>
        )
      }
    >
      {isApiMissing ? (
        <p className="text-sm text-fg-tertiary">
          Сервис карт должностей пока не подключён.
        </p>
      ) : loading ? (
        <Skeleton className="h-24 w-full" />
      ) : !profile || !profile.summaryCache ? (
        <p className="text-sm text-fg-tertiary">
          Карта формируется. Заполнится автоматически по мере поступления
          материалов.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {profile.summaryCache.blocks.map((block) => (
            <div key={block.key}>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
                {block.title ?? BLOCK_TITLES[block.key] ?? block.key}
              </h3>
              {block.items.length === 0 ? (
                <p className="text-sm text-fg-tertiary">—</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-fg-primary">
                  {block.items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {profile?.sources && profile.sources.length > 0 && (
        <div className="mt-5 border-t border-border-subtle pt-3">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
            Источники
          </h3>
          <ul className="space-y-1 text-sm">
            {profile.sources.slice(0, 12).map((s) => (
              <li key={`${s.type}-${s.id}`} className="text-fg-secondary">
                <span className="mr-2 text-fg-tertiary">[{sourceLabel(s.type)}]</span>
                {s.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function sourceLabel(t: 'meeting' | 'document' | 'dump'): string {
  if (t === 'meeting') return 'встреча';
  if (t === 'document') return 'документ';
  return 'дамп';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
