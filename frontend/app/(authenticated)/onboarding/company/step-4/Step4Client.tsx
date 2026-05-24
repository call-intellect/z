'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check, CloudUpload, Loader2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { documentsApi } from '@/api/documents.api';
import { rolesDomainApi, type RoleDomainApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { WizardStepNav } from '../WizardStepNav';

const PREV_HREF = '/onboarding/company/step-3';
const NEXT_HREF = '/onboarding/company/step-5';

interface RowState {
  status: 'idle' | 'uploading' | 'done' | 'error';
  fileName?: string;
  errorMessage?: string;
}

/**
 * Шаг 4 — Должностные инструкции. Опционален: можно «Пропустить».
 * Каждая должность — отдельный drag-drop. На успех — кнопка «Загружено»
 * (зелёная галочка), пользователь может перейти дальше.
 */
export function Step4Client() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const [roles, setRoles] = useState<RoleDomainApi[] | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  useEffect(() => {
    if (!currentOrgId) return;
    let cancelled = false;
    void rolesDomainApi
      .list(currentOrgId)
      .then((res) => {
        if (cancelled) return;
        setRoles(res.items);
      })
      .catch(() => {
        if (cancelled) return;
        setRoles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrgId]);

  const handleFile = async (roleId: string, file: File) => {
    if (!currentOrgId) return;
    setRowStates((s) => ({
      ...s,
      [roleId]: { status: 'uploading', fileName: file.name },
    }));
    try {
      await documentsApi.upload(currentOrgId, {
        file,
        attachedRoleId: roleId,
      });
      setRowStates((s) => ({
        ...s,
        [roleId]: { status: 'done', fileName: file.name },
      }));
      toast.success(`«${file.name}» загружено.`);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : 'Не удалось загрузить файл.';
      setRowStates((s) => ({
        ...s,
        [roleId]: {
          status: 'error',
          fileName: file.name,
          errorMessage: msg,
        },
      }));
      toast.error(msg);
    }
  };

  if (roles === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
        Должностные инструкции
      </h1>
      <p className="mt-2 text-sm text-fg-secondary">
        Загрузите файл для каждой должности — он попадёт в карту должности. Шаг
        не обязателен: можно пропустить и загрузить позже из раздела
        «Структура».
      </p>

      {roles.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-border-subtle p-6 text-center text-sm text-fg-tertiary">
          Должностей пока нет. Можно пропустить и вернуться позже.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {roles.map((role) => (
            <RoleUploadRow
              key={role.id}
              role={role}
              state={rowStates[role.id] ?? { status: 'idle' }}
              onFile={(file) => void handleFile(role.id, file)}
            />
          ))}
        </div>
      )}

      <WizardStepNav
        prevHref={PREV_HREF}
        onSkip={() => router.push(NEXT_HREF)}
        onNext={() => router.push(NEXT_HREF)}
        nextLabel="Далее"
      />
    </section>
  );
}

function RoleUploadRow({
  role,
  state,
  onFile,
}: {
  role: RoleDomainApi;
  state: RowState;
  onFile: (file: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputId = `dz-${role.id}`;
  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-fg-primary">{role.name}</div>
          {role.departmentName && (
            <div className="text-xs text-fg-tertiary">{role.departmentName}</div>
          )}
        </div>
        {state.status === 'done' && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check size={14} /> Загружено
          </span>
        )}
        {state.status === 'uploading' && (
          <span className="inline-flex items-center gap-1 text-xs text-fg-tertiary">
            <Loader2 size={14} className="animate-spin" /> Загружаем…
          </span>
        )}
      </div>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm transition-colors ${
          dragOver
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border-subtle text-fg-tertiary hover:border-accent/60 hover:text-fg-secondary'
        }`}
      >
        <CloudUpload size={16} />
        {state.fileName
          ? `Заменить «${state.fileName}»`
          : 'Перетащите файл или нажмите, чтобы выбрать'}
        <input
          id={inputId}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx,.txt,.md,.rtf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </label>
      {state.status === 'error' && state.errorMessage && (
        <p className="mt-2 text-xs text-danger">{state.errorMessage}</p>
      )}
    </div>
  );
}
