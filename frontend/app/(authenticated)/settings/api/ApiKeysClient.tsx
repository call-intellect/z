'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  apiKeysApi,
  type ApiKeyApi,
  type ApiKeyScope,
  type CreateApiKeyApiResponse,
} from '@/api/api-keys.api';
import { useToast } from '@/contexts/toast-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ApiKeysClient() {
  const { addToast } = useToast();
  const [keys, setKeys] = useState<ApiKeyApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreateApiKeyApiResponse | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiKeysApi.list();
      setKeys(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить ключи');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  const handleRevoke = async (id: string) => {
    if (!confirm('Отозвать ключ? Все запросы с ним будут отклоняться.')) return;
    try {
      await apiKeysApi.revoke(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      addToast({ type: 'success', message: 'Ключ отозван' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось отозвать',
      });
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            API ключи
          </h1>
          <p className="text-sm text-fg-secondary">
            Для доступа к Public REST API от вашего имени.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus size={14} /> Создать ключ
        </Button>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}

      {error && !loading && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!loading && !error && keys.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card/40 p-10 text-center text-sm text-fg-secondary">
          У вас пока нет API-ключей.
        </div>
      )}

      {!loading && !error && keys.length > 0 && (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-start gap-3 rounded-lg border border-border-subtle bg-bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-fg-primary">{k.name}</span>
                  <code className="rounded bg-bg-overlay px-1.5 py-0.5 font-mono text-[11px] text-fg-secondary">
                    {k.prefix}…
                  </code>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-tertiary">
                  {k.scopes.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                  <span>· создан {formatDate(k.createdAt)}</span>
                  <span>· последнее использование {formatDate(k.lastUsedAt)}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleRevoke(k.id)}
                className="hover:text-danger"
              >
                <Trash2 size={13} /> Отозвать
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Документация */}
      <div className="mt-8 rounded-lg border border-border-subtle bg-bg-card p-4">
        <h2 className="text-sm font-semibold text-fg-primary">Документация Public REST API</h2>
        <p className="mt-1 text-xs text-fg-secondary">
          Используйте API-ключ как Bearer-token в заголовке{' '}
          <code className="rounded bg-bg-overlay px-1 py-0.5 font-mono">Authorization</code>.
        </p>
        <a
          href="/api/public/v1/docs"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          Открыть Swagger UI <ExternalLink size={11} />
        </a>
      </div>

      <CreateKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(res) => {
          setCreatedKey(res);
          setCreateOpen(false);
          void fetchKeys();
        }}
      />

      <CreatedKeyDialog
        result={createdKey}
        onClose={() => setCreatedKey(null)}
      />
    </div>
  );
}

function CreateKeyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (res: CreateApiKeyApiResponse) => void;
}) {
  const { addToast } = useToast();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['read']);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setScopes(['read']);
    }
  }, [open]);

  const toggleScope = (s: ApiKeyScope) => {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const handleSubmit = async () => {
    if (!name.trim() || scopes.length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiKeysApi.create({ name: name.trim(), scopes });
      onCreated(res);
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось создать',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый API-ключ</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="key-name">Название</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              placeholder="Например: CRM-интеграция"
            />
          </div>
          <div className="space-y-2">
            <Label>Права (scopes)</Label>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={scopes.includes('read')}
                  onCheckedChange={() => toggleScope('read')}
                />
                <span className="text-fg-primary">read</span>
                <span className="text-xs text-fg-tertiary">— чтение встреч, задач, тегов</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={scopes.includes('write')}
                  onCheckedChange={() => toggleScope('write')}
                />
                <span className="text-fg-primary">write</span>
                <span className="text-xs text-fg-tertiary">— изменение задач, тегов</span>
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitting || !name.trim() || scopes.length === 0}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatedKeyDialog({
  result,
  onClose,
}: {
  result: CreateApiKeyApiResponse | null;
  onClose: () => void;
}) {
  const { addToast } = useToast();
  const open = result !== null;

  const handleCopy = () => {
    if (!result) return;
    void navigator.clipboard.writeText(result.rawKey).then(
      () => addToast({ type: 'success', message: 'Скопировано' }),
      () => addToast({ type: 'error', message: 'Не удалось скопировать' }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ключ создан</DialogTitle>
          <DialogDescription>
            Это единственный раз, когда вы видите ключ целиком. Сохраните его сейчас —
            восстановить позже невозможно.
          </DialogDescription>
        </DialogHeader>
        {result && (
          <div className="space-y-2">
            <Label>Ваш ключ</Label>
            <div className="flex gap-2">
              <code className="flex-1 select-all break-all rounded-md border border-border-subtle bg-bg-overlay p-3 font-mono text-xs text-fg-primary">
                {result.rawKey}
              </code>
              <Button onClick={handleCopy} variant="secondary">
                <Copy size={14} />
              </Button>
            </div>
            <p className="text-xs text-fg-tertiary">
              Передавайте как Bearer-token: <code className="font-mono">Authorization: Bearer {result.prefix}…</code>
            </p>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
