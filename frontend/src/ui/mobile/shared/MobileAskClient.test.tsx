/**
 * RTL-тест мобильного экрана «Спросить» (B4/Ф5).
 *
 * Покрытие:
 *   (а) exec-роль (owner) — отрендерены exec-промпты;
 *   (б) тап по промпт-кнопке подставляет её текст в поле ввода;
 *   (в) manager-роль — отрендерены manager-промпты, нет exec-набора;
 *   (г) Р8 — никакой озвучки/TTS: нет «🔊»/«Слушать»/voiceMode в DOM.
 *
 * Моки: auth-context (currentOrgRole/currentOrgId), chat.api (history пустая),
 * VoiceInputButton (чтобы не тянуть MediaRecorder/getUserMedia в jsdom).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let role: 'owner' | 'admin' | 'manager' | 'coo' | null = 'owner';
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentOrgRole: role, currentOrgId: 'org-test' }),
}));

vi.mock('@/api/chat.api', () => ({
  chatApi: {
    historyGlobal: vi.fn().mockResolvedValue({ items: [] }),
    askV2: vi.fn(),
    sendGlobal: vi.fn(),
  },
}));

// VoiceInputButton тянет MediaRecorder/getUserMedia — в jsdom их нет. Мокаем
// лёгкой заглушкой (кнопка-ввод присутствует, без записи).
vi.mock('@/ui/components/voice/VoiceInputButton', () => ({
  VoiceInputButton: () => <button type="button">Голосовой ввод</button>,
  appendTranscript: (prev: string, t: string) => (prev ? `${prev} ${t}` : t),
}));

import { MobileAskClient } from './MobileAskClient';

afterEach(() => {
  vi.clearAllMocks();
  role = 'owner';
});

describe('MobileAskClient', () => {
  it('(а) exec-роль (owner) — отрендерены exec-промпты', () => {
    role = 'owner';
    render(<MobileAskClient />);
    expect(screen.getByText('Спросить')).toBeInTheDocument();
    expect(screen.getByText('Сводка за неделю')).toBeInTheDocument();
    expect(screen.getByText('Риски по проекту')).toBeInTheDocument();
    expect(screen.getByText('Кому помочь с обещаниями')).toBeInTheDocument();
  });

  it('(б) тап по промпт-кнопке подставляет текст в поле ввода', () => {
    role = 'owner';
    render(<MobileAskClient />);
    const chip = screen.getByText('Риски по проекту');
    fireEvent.click(chip);
    const textarea = screen.getByPlaceholderText(
      'Спросите Кору о памяти компании…',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Риски по проекту');
  });

  it('(в) manager-роль — manager-промпты, нет exec-набора', () => {
    role = 'manager';
    render(<MobileAskClient />);
    expect(screen.getByText('Как у нас оформляют…')).toBeInTheDocument();
    expect(screen.getByText('Спросить клон должности')).toBeInTheDocument();
    expect(screen.queryByText('Сводка за неделю')).toBeNull();
  });

  it('(г) Р8 — нет озвучки/TTS в DOM', () => {
    role = 'owner';
    const { container } = render(<MobileAskClient />);
    expect(container.textContent ?? '').not.toMatch(/🔊|Слушать|voiceMode/i);
  });
});
