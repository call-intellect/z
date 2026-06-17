"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Circle,
  Copy,
  FileText,
  ListChecks,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Send,
  Share2,
  Sparkles,
  StickyNote,
  Volume2,
  X,
} from "lucide-react";

const T = {
  bgBase: "#0A0E14",
  bgElevated: "#11161E",
  bgCard: "#161D26",
  bgOverlay: "#1B232E",
  borderSubtle: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.18)",
  textPrimary: "#E8EAED",
  textSecondary: "#A0A6B0",
  textTertiary: "#6B7280",
  accent: "#5EEAD4",
  accentHover: "#7CF2DD",
  accentMuted: "rgba(94,234,212,0.12)",
  accentMutedStrong: "rgba(94,234,212,0.20)",
  accentBorder: "rgba(94,234,212,0.28)",
  accentGlow: "0 0 32px rgba(94,234,212,0.35)",
  success: "#4ADE80",
  warning: "#FBBF24",
  danger: "#F87171",
  fontSans:
    '"Geist", "Geist Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontMono:
    '"Geist Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
};

const SPRING = { type: "spring", stiffness: 300, damping: 30 } as const;
const SPRING_BOUNCY = { type: "spring", stiffness: 400, damping: 22 } as const;

const MEETING = {
  id: "mtg_01HXY7K9ZQ4M",
  title: "Демо для Acme Corp · стратегический звонок",
  type: "Sales",
  date: "8 мая 2026 · 14:00",
  durationMs: 7_338_000,
  recapVersion: 2,
};

const PARTICIPANTS = [
  {
    id: "u1",
    name: "Сергей Мазуренко",
    role: "Z · Founder",
    initials: "СМ",
    speakingMs: 2_840_000,
    isHost: true,
  },
  {
    id: "u2",
    name: "Иван Колесников",
    role: "Acme · CTO",
    initials: "ИК",
    speakingMs: 2_310_000,
    isHost: false,
  },
  {
    id: "u3",
    name: "Анна Лесникова",
    role: "Acme · Head of RevOps",
    initials: "АЛ",
    speakingMs: 1_580_000,
    isHost: false,
  },
  {
    id: "u4",
    name: "Виктор Громов",
    role: "Acme · Data Lead",
    initials: "ВГ",
    speakingMs: 608_000,
    isHost: false,
  },
];

const CHAPTERS = [
  {
    id: "c1",
    startMs: 0,
    endMs: 720_000,
    title: "Знакомство и разогрев",
    summary: "Обмен контекстом — кто что делает, кто решает.",
  },
  {
    id: "c2",
    startMs: 720_000,
    endMs: 2_580_000,
    title: "Демо платформы",
    summary: "Прошли по live-сценарию: запись, AI-отчёт, шеринг по ссылке.",
  },
  {
    id: "c3",
    startMs: 2_580_000,
    endMs: 4_920_000,
    title: "Возражения по интеграции",
    summary: "Сомнения по совместимости с HubSpot и Clay; вопрос про SOC2.",
  },
  {
    id: "c4",
    startMs: 4_920_000,
    endMs: 6_360_000,
    title: "Бюджет и сроки",
    summary:
      "Acme озвучили диапазон 350–500к/мес, готовы к 90-дневному пилоту.",
  },
  {
    id: "c5",
    startMs: 6_360_000,
    endMs: 7_338_000,
    title: "Next steps",
    summary: "Договорились о trial-доступе и следующей встрече через неделю.",
  },
];

const HIGHLIGHTS = [
  { id: "h1", startMs: 4_982_000, label: "Бюджет 500к" },
  { id: "h2", startMs: 752_000, label: "HubSpot integration" },
  { id: "h3", startMs: 6_490_000, label: "Trial доступ" },
  { id: "h4", startMs: 3_120_000, label: "SOC2 требование" },
];

const TRANSCRIPT = [
  {
    id: "tr1",
    startMs: 740_000,
    speakerId: "u1",
    text: "Хорошо, давайте я покажу как у нас устроен AI-отчёт под sales-звонки.",
  },
  {
    id: "tr2",
    startMs: 752_000,
    speakerId: "u2",
    text: "Главный вопрос — как это соединяется с нашим HubSpot. У нас там вся история клиентов.",
  },
  {
    id: "tr3",
    startMs: 768_000,
    speakerId: "u1",
    text: "У нас есть outgoing webhooks и REST API. Можно через Zapier на старте, потом — нативный коннектор.",
  },
  {
    id: "tr4",
    startMs: 784_000,
    speakerId: "u3",
    text: "Покажете прямо сейчас, как это будет выглядеть на нашем pipeline?",
  },
  {
    id: "tr5",
    startMs: 3_118_000,
    speakerId: "u2",
    text: "У нас compliance-отдел потребует SOC2 Type 2 и DPA до подписания контракта.",
  },
  {
    id: "tr6",
    startMs: 4_982_000,
    speakerId: "u2",
    text: "Мы готовы рассмотреть бюджет до 500 тысяч в месяц, если увидим ROI за 3 месяца.",
  },
  {
    id: "tr7",
    startMs: 5_005_000,
    speakerId: "u1",
    text: "Спасибо за прямоту. Давайте определим метрики ROI и состав пилотного пакета.",
  },
  {
    id: "tr8",
    startMs: 6_482_000,
    speakerId: "u3",
    text: "Заводите trial-доступ на 14 дней — соберём команду и пройдём сценарий.",
  },
];

const TASKS = [
  {
    id: "t1",
    title: "Прислать пример webhook-payload для HubSpot-интеграции",
    assignee: "Сергей",
    dueDate: "10 мая",
    confidence: 0.95,
    sourceQuote:
      "У нас есть outgoing webhooks и REST API. Можно через Zapier на старте, потом — нативный коннектор.",
    sourceMs: 768_000,
    status: "open" as const,
  },
  {
    id: "t2",
    title: "Подготовить пилотный SOW с 90-дневным окном измерения ROI",
    assignee: "Сергей",
    dueDate: "13 мая",
    confidence: 0.88,
    sourceQuote:
      "Мы готовы рассмотреть бюджет до 500 тысяч в месяц, если увидим ROI за 3 месяца.",
    sourceMs: 4_982_000,
    status: "open" as const,
  },
  {
    id: "t3",
    title: "Свести требования по compliance и подготовить SOC2-statement",
    assignee: "Анна (Acme)",
    dueDate: "15 мая",
    confidence: 0.72,
    sourceQuote:
      "У нас compliance-отдел потребует SOC2 Type 2 и DPA до подписания контракта.",
    sourceMs: 3_118_000,
    status: "in_progress" as const,
  },
  {
    id: "t4",
    title: "Trial-доступ для команды Acme на 14 дней",
    assignee: "Сергей",
    dueDate: "9 мая",
    confidence: 0.99,
    sourceQuote:
      "Заводите trial-доступ на 14 дней — соберём команду и пройдём сценарий.",
    sourceMs: 6_482_000,
    status: "done" as const,
  },
];

type AiCitationData = { startMs: number; speakerId: string; text: string };
type AiMessage =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      citations: AiCitationData[];
    };

const INITIAL_CHAT: AiMessage[] = [
  { id: "m1", role: "user", content: "Какие были главные возражения клиента?" },
  {
    id: "m2",
    role: "assistant",
    content:
      "У Acme два основных возражения. Первое — техническое: совместимость с их HubSpot и Clay-стеком; они опасаются, что AI-отчёт не попадёт в sales pipeline автоматически. Второе — compliance: SOC2 Type 2 и DPA как блокирующие условия до подписания.",
    citations: [
      {
        startMs: 752_000,
        speakerId: "u2",
        text: "Главный вопрос — как это соединяется с нашим HubSpot. У нас там вся история клиентов.",
      },
      {
        startMs: 3_118_000,
        speakerId: "u2",
        text: "У нас compliance-отдел потребует SOC2 Type 2 и DPA до подписания контракта.",
      },
    ],
  },
  { id: "m3", role: "user", content: "Что Acme сказали по бюджету?" },
  {
    id: "m4",
    role: "assistant",
    content:
      "Озвучили потолок 500 000 в месяц при условии измеримого ROI в течение трёх месяцев. Готовы запустить 90-дневный пилот.",
    citations: [
      {
        startMs: 4_982_000,
        speakerId: "u2",
        text: "Мы готовы рассмотреть бюджет до 500 тысяч в месяц, если увидим ROI за 3 месяца.",
      },
    ],
  },
];

const SUGGESTED_PROMPTS = [
  "Что мы решили по срокам?",
  "Какие риски обсудили?",
  "Сделай follow-up письмо",
  "Кто принимает решение со стороны Acme?",
];

const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
    : `${m}:${sec.toString().padStart(2, "0")}`;
};

const fmtPct = (n: number) => `${Math.round(n * 100)}%`;

const speakerById = (id: string) => PARTICIPANTS.find((p) => p.id === id);

export function MeetingResultPage() {
  const [currentMs, setCurrentMs] = useState(2_982_000);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [chatOpen, setChatOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<AiMessage[]>(INITIAL_CHAT);
  const [thinking, setThinking] = useState(false);
  const [pulseAt, setPulseAt] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(MEETING.title);

  const currentChapter = useMemo(
    () =>
      CHAPTERS.find((c) => currentMs >= c.startMs && currentMs < c.endMs) ??
      CHAPTERS[0],
    [currentMs],
  );

  const seek = (ms: number) => {
    setCurrentMs(ms);
    setPulseAt(ms);
    setTimeout(() => setPulseAt(null), 800);
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    const userMsg: AiMessage = {
      id: `m${Date.now()}`,
      role: "user",
      content: chatInput,
    };
    setChatHistory((h) => [...h, userMsg]);
    setChatInput("");
    setThinking(true);
    setTimeout(() => {
      setChatHistory((h) => [
        ...h,
        {
          id: `m${Date.now() + 1}`,
          role: "assistant",
          content:
            "Демо-ответ для эталона. В production-коде здесь придёт ответ от LlmRouter с цитатами из транскрипта.",
          citations: [
            {
              startMs: 5_005_000,
              speakerId: "u1",
              text: "Спасибо за прямоту. Давайте определим метрики ROI и состав пилотного пакета.",
            },
          ],
        },
      ]);
      setThinking(false);
    }, 2200);
  };

  return (
    <div
      style={{
        background: T.bgBase,
        color: T.textPrimary,
        fontFamily: T.fontSans,
        minHeight: "100vh",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
      }}
    >
      <BackgroundDecor />
      <Header
        title={title}
        onTitle={setTitle}
        editing={editingTitle}
        setEditing={setEditingTitle}
        chatOpen={chatOpen}
        onChatToggle={() => setChatOpen((v) => !v)}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: chatOpen
            ? "280px minmax(0, 1fr) 380px"
            : "280px minmax(0, 1fr) 56px",
          gap: 24,
          maxWidth: 1440,
          margin: "0 auto",
          padding: "24px 32px 64px",
          transition:
            "grid-template-columns 280ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <LeftColumn
          currentChapter={currentChapter}
          activeTab={activeTab}
          onSeek={seek}
        />

        <CenterColumn
          currentMs={currentMs}
          isPlaying={isPlaying}
          onPlayToggle={() => setIsPlaying((p) => !p)}
          onSeek={seek}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          pulseAt={pulseAt}
        />

        <RightColumn
          open={chatOpen}
          onOpen={() => setChatOpen(true)}
          history={chatHistory}
          input={chatInput}
          onInput={setChatInput}
          onSend={sendChat}
          thinking={thinking}
          onSeek={seek}
          onClose={() => setChatOpen(false)}
        />
      </div>
    </div>
  );
}

function BackgroundDecor() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        background:
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(94,234,212,0.06), transparent 60%), radial-gradient(ellipse 50% 40% at 100% 100%, rgba(94,234,212,0.03), transparent 60%)",
        zIndex: 0,
      }}
    />
  );
}

function Header({
  title,
  onTitle,
  editing,
  setEditing,
  chatOpen,
  onChatToggle,
}: {
  title: string;
  onTitle: (v: string) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  chatOpen: boolean;
  onChatToggle: () => void;
}) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 72,
        display: "flex",
        alignItems: "center",
        gap: 24,
        padding: "0 32px",
        background: "rgba(17,22,30,0.72)",
        backdropFilter: "blur(12px) saturate(1.4)",
        WebkitBackdropFilter: "blur(12px) saturate(1.4)",
        borderBottom: `1px solid ${T.borderSubtle}`,
      }}
    >
      <Logo />

      <Breadcrumbs items={["Встречи", "Sales · Acme Corp"]} />

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 12,
          minWidth: 0,
        }}
      >
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") setEditing(false);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: T.fontSans,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: T.textPrimary,
              background: T.bgOverlay,
              border: `1px solid ${T.accentBorder}`,
              borderRadius: 8,
              padding: "6px 12px",
              outline: "none",
            }}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "left",
              fontFamily: T.fontSans,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: T.textPrimary,
              background: "transparent",
              border: "none",
              padding: "6px 0",
              cursor: "text",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </button>
        )}

        <Badge tone="mint">Sales</Badge>
        <span
          style={{
            fontFamily: T.fontMono,
            fontSize: 13,
            color: T.textSecondary,
          }}
        >
          {fmtTime(MEETING.durationMs)}
        </span>
        <span style={{ fontSize: 13, color: T.textTertiary }}>·</span>
        <span style={{ fontSize: 13, color: T.textSecondary }}>
          {MEETING.date}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ButtonOutline icon={<Share2 size={14} strokeWidth={1.75} />}>
          Поделиться
        </ButtonOutline>
        <ButtonGhost square aria-label="Меню">
          <MoreHorizontal size={18} strokeWidth={1.75} />
        </ButtonGhost>
        <div
          style={{
            width: 1,
            height: 24,
            background: T.borderSubtle,
            margin: "0 4px",
          }}
        />
        <ButtonGhost square onClick={onChatToggle} aria-label="AI-помощник">
          <Sparkles
            size={18}
            strokeWidth={1.75}
            style={{ color: chatOpen ? T.accent : T.textSecondary }}
          />
        </ButtonGhost>
        <Avatar initials="СМ" size={32} accent />
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 8 }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: T.accent,
          color: T.bgBase,
          display: "grid",
          placeItems: "center",
          fontFamily: T.fontMono,
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          boxShadow: T.accentGlow,
        }}
      >
        Z
      </div>
    </div>
  );
}

function Breadcrumbs({ items }: { items: string[] }) {
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 13,
              color: i === items.length - 1 ? T.textSecondary : T.textTertiary,
            }}
          >
            {item}
          </span>
          {i < items.length - 1 && (
            <ChevronRight
              size={12}
              strokeWidth={1.75}
              style={{ color: T.textTertiary }}
            />
          )}
        </span>
      ))}
    </nav>
  );
}

function LeftColumn({
  currentChapter,
  activeTab,
  onSeek,
}: {
  currentChapter: (typeof CHAPTERS)[number];
  activeTab: TabKey;
  onSeek: (ms: number) => void;
}) {
  return (
    <aside
      style={{
        position: "sticky",
        top: 96,
        alignSelf: "start",
        height: "calc(100vh - 120px)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 32,
        paddingRight: 8,
      }}
    >
      <SmartChaptersTimeline
        currentChapterId={currentChapter.id}
        onJump={onSeek}
      />
      <TocPanel activeTab={activeTab} />
      <ParticipantsList />
    </aside>
  );
}

function SmartChaptersTimeline({
  currentChapterId,
  onJump,
}: {
  currentChapterId: string;
  onJump: (ms: number) => void;
}) {
  return (
    <Section title="Главы">
      <div style={{ position: "relative", paddingLeft: 16 }}>
        <div
          style={{
            position: "absolute",
            left: 4,
            top: 6,
            bottom: 6,
            width: 1,
            background: T.borderSubtle,
          }}
        />
        {CHAPTERS.map((c) => {
          const isCurrent = c.id === currentChapterId;
          return (
            <button
              key={c.id}
              onClick={() => onJump(c.startMs)}
              style={{
                display: "block",
                width: "100%",
                position: "relative",
                textAlign: "left",
                padding: "8px 0 12px 16px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
              className="chapter-item"
            >
              <span
                style={{
                  position: "absolute",
                  left: -1.5,
                  top: 12,
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: isCurrent ? T.accent : T.borderStrong,
                  boxShadow: isCurrent ? T.accentGlow : "none",
                }}
              />
              {isCurrent && (
                <motion.span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: -7.5,
                    top: 6,
                    width: 19,
                    height: 19,
                    borderRadius: 999,
                    border: `1px solid ${T.accent}`,
                    pointerEvents: "none",
                  }}
                  animate={{ opacity: [0.6, 0, 0.6], scale: [0.8, 1.2, 0.8] }}
                  transition={{
                    duration: 2.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}
              <div
                style={{
                  fontSize: 14,
                  fontWeight: isCurrent ? 500 : 400,
                  color: isCurrent ? T.textPrimary : T.textSecondary,
                  lineHeight: 1.35,
                  letterSpacing: "-0.005em",
                }}
              >
                {c.title}
              </div>
              <div
                style={{
                  marginTop: 2,
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  color: T.textTertiary,
                }}
              >
                {fmtTime(c.startMs)} – {fmtTime(c.endMs)}
              </div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function TocPanel({ activeTab }: { activeTab: TabKey }) {
  const items: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Обзор" },
    { key: "chapters", label: "Главы" },
    { key: "transcript", label: "Транскрипт" },
    { key: "tasks", label: "Задачи" },
    { key: "notes", label: "Заметки" },
  ];
  return (
    <Section title="Разделы">
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((it) => {
          const active = it.key === activeTab;
          return (
            <div
              key={it.key}
              style={{
                position: "relative",
                padding: "8px 0 8px 12px",
                fontSize: 13,
                color: active ? T.textPrimary : T.textSecondary,
                fontWeight: active ? 500 : 400,
              }}
            >
              {active && (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: T.accent,
                    borderRadius: 2,
                  }}
                />
              )}
              {it.label}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ParticipantsList() {
  const total = PARTICIPANTS.reduce((s, p) => s + p.speakingMs, 0);
  return (
    <Section title="Участники">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {PARTICIPANTS.map((p) => (
          <div
            key={p.id}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <Avatar initials={p.initials} size={28} accent={p.isHost} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: T.textPrimary,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.name}
              </div>
              <div style={{ fontSize: 11, color: T.textTertiary }}>
                {p.role}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  color: T.textSecondary,
                }}
              >
                {fmtPct(p.speakingMs / total)}
              </div>
              <div
                style={{
                  marginTop: 4,
                  width: 48,
                  height: 2,
                  background: T.borderSubtle,
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: fmtPct(p.speakingMs / total),
                    background: p.isHost ? T.accent : T.textTertiary,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: T.textTertiary,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

type TabKey = "overview" | "chapters" | "transcript" | "tasks" | "notes";

function CenterColumn({
  currentMs,
  isPlaying,
  onPlayToggle,
  onSeek,
  activeTab,
  onTabChange,
  pulseAt,
}: {
  currentMs: number;
  isPlaying: boolean;
  onPlayToggle: () => void;
  onSeek: (ms: number) => void;
  activeTab: TabKey;
  onTabChange: (t: TabKey) => void;
  pulseAt: number | null;
}) {
  return (
    <main
      style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}
    >
      <MeetingVideoPlayer
        currentMs={currentMs}
        isPlaying={isPlaying}
        onPlayToggle={onPlayToggle}
        onSeek={onSeek}
        pulseAt={pulseAt}
      />
      <MeetingTabs active={activeTab} onChange={onTabChange} />
      <div style={{ minHeight: 400 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeTab === "overview" && <OverviewTab />}
            {activeTab === "chapters" && <ChaptersTab onSeek={onSeek} />}
            {activeTab === "transcript" && (
              <TranscriptTab currentMs={currentMs} onSeek={onSeek} />
            )}
            {activeTab === "tasks" && <TasksTab onSeek={onSeek} />}
            {activeTab === "notes" && <NotesTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}

function MeetingVideoPlayer({
  currentMs,
  isPlaying,
  onPlayToggle,
  onSeek,
  pulseAt,
}: {
  currentMs: number;
  isPlaying: boolean;
  onPlayToggle: () => void;
  onSeek: (ms: number) => void;
  pulseAt: number | null;
}) {
  const ratio = currentMs / MEETING.durationMs;

  return (
    <div
      style={{
        position: "relative",
        background: T.bgCard,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: 24,
        overflow: "hidden",
      }}
    >
      {}
      <div
        style={{
          aspectRatio: "16 / 9",
          background:
            "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(94,234,212,0.04), transparent 70%), linear-gradient(135deg, #0E141C 0%, #0A0E14 100%)",
          display: "grid",
          placeItems: "center",
          position: "relative",
        }}
      >
        {}
        <div
          style={{
            position: "absolute",
            inset: 24,
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 12,
            opacity: 0.6,
          }}
        >
          {PARTICIPANTS.slice(0, 4).map((p) => (
            <div
              key={p.id}
              style={{
                background: T.bgElevated,
                border: `1px solid ${T.borderSubtle}`,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                position: "relative",
              }}
            >
              <Avatar initials={p.initials} size={56} accent={p.isHost} />
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 8,
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  color: T.textSecondary,
                  background: "rgba(10,14,20,0.7)",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                {p.initials}
              </div>
            </div>
          ))}
        </div>
        {}
        <button
          onClick={onPlayToggle}
          aria-label={isPlaying ? "Пауза" : "Воспроизведение"}
          style={{
            position: "relative",
            width: 72,
            height: 72,
            borderRadius: 999,
            background: "rgba(10,14,20,0.6)",
            border: `1px solid ${T.accentBorder}`,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            color: T.accent,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            boxShadow: T.accentGlow,
          }}
        >
          {isPlaying ? (
            <Pause size={28} strokeWidth={1.5} />
          ) : (
            <Play size={28} strokeWidth={1.5} style={{ marginLeft: 4 }} />
          )}
        </button>
      </div>

      {}
      <div
        style={{
          padding: "16px 20px 18px",
          borderTop: `1px solid ${T.borderSubtle}`,
          background: T.bgElevated,
        }}
      >
        <Scrubber
          ratio={ratio}
          onSeek={(r) => onSeek(Math.floor(r * MEETING.durationMs))}
          pulseAt={pulseAt != null ? pulseAt / MEETING.durationMs : null}
        />
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: T.textSecondary,
          }}
        >
          <ButtonGhost square onClick={onPlayToggle}>
            {isPlaying ? (
              <Pause size={16} strokeWidth={1.75} />
            ) : (
              <Play size={16} strokeWidth={1.75} />
            )}
          </ButtonGhost>
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 12,
              color: T.textSecondary,
            }}
          >
            {fmtTime(currentMs)}{" "}
            <span style={{ color: T.textTertiary }}>
              / {fmtTime(MEETING.durationMs)}
            </span>
          </span>
          <div style={{ flex: 1 }} />
          <SpeedSelector />
          <ButtonGhost square aria-label="Громкость">
            <Volume2 size={16} strokeWidth={1.75} />
          </ButtonGhost>
          <ButtonGhost square aria-label="PIP">
            <PictureInPicture2 size={16} strokeWidth={1.75} />
          </ButtonGhost>
          <ButtonGhost square aria-label="Полноэкранный">
            <Maximize2 size={16} strokeWidth={1.75} />
          </ButtonGhost>
        </div>
      </div>
    </div>
  );
}

function Scrubber({
  ratio,
  onSeek,
  pulseAt,
}: {
  ratio: number;
  onSeek: (r: number) => void;
  pulseAt: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const r = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, r)));
  };
  return (
    <div
      ref={ref}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        height: 18,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
      }}
    >
      {}
      <div
        style={{
          position: "relative",
          height: hovered ? 4 : 2,
          width: "100%",
          background: T.borderSubtle,
          borderRadius: 4,
          transition: "height 160ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {}
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${ratio * 100}%`,
            background: T.accent,
            borderRadius: 4,
            boxShadow: hovered ? T.accentGlow : "none",
            transition: "box-shadow 160ms",
          }}
        />
        {}
        {CHAPTERS.slice(1).map((c) => {
          const left = (c.startMs / MEETING.durationMs) * 100;
          return (
            <div
              key={c.id}
              title={c.title}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: -2,
                height: hovered ? 8 : 6,
                width: 2,
                background: T.accentMutedStrong,
                borderRadius: 2,
                transition: "all 160ms",
              }}
            />
          );
        })}
        {}
        {HIGHLIGHTS.map((h) => {
          const left = (h.startMs / MEETING.durationMs) * 100;
          return (
            <div
              key={h.id}
              title={h.label}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: -3,
                width: 8,
                height: 8,
                marginLeft: -4,
                borderRadius: 999,
                background: T.accent,
                boxShadow: T.accentGlow,
              }}
            />
          );
        })}
        {}
        <AnimatePresence>
          {pulseAt != null && (
            <motion.div
              key={pulseAt}
              initial={{ opacity: 0.6, scale: 1 }}
              animate={{ opacity: 0, scale: 4 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              style={{
                position: "absolute",
                left: `${pulseAt * 100}%`,
                top: -4,
                width: 10,
                height: 10,
                marginLeft: -5,
                borderRadius: 999,
                border: `2px solid ${T.accent}`,
                pointerEvents: "none",
              }}
            />
          )}
        </AnimatePresence>
        {}
        <div
          style={{
            position: "absolute",
            left: `${ratio * 100}%`,
            top: "50%",
            width: hovered ? 12 : 10,
            height: hovered ? 12 : 10,
            transform: "translate(-50%, -50%)",
            borderRadius: 999,
            background: T.accent,
            transition: "all 160ms cubic-bezier(0.16, 1, 0.3, 1)",
            boxShadow: T.accentGlow,
          }}
        />
      </div>
    </div>
  );
}

function SpeedSelector() {
  const [speed, setSpeed] = useState("1x");
  const options = ["1x", "1.25x", "1.5x", "2x"];
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          fontFamily: T.fontMono,
          fontSize: 12,
          color: T.textSecondary,
          background: "transparent",
          border: `1px solid ${T.borderSubtle}`,
          borderRadius: 6,
          padding: "4px 10px",
          cursor: "pointer",
        }}
      >
        {speed}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={SPRING}
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              right: 0,
              background: T.bgCard,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: 4,
              minWidth: 80,
              zIndex: 20,
            }}
          >
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  setSpeed(opt);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  fontSize: 12,
                  fontFamily: T.fontMono,
                  color: opt === speed ? T.accent : T.textSecondary,
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                {opt}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MeetingTabs({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
}) {
  const tabs: {
    key: TabKey;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }[] = [
    {
      key: "overview",
      label: "Обзор",
      icon: <FileText size={14} strokeWidth={1.75} />,
    },
    {
      key: "chapters",
      label: "Главы",
      icon: <Circle size={14} strokeWidth={1.75} />,
      count: CHAPTERS.length,
    },
    {
      key: "transcript",
      label: "Транскрипт",
      icon: <MessageSquareText size={14} strokeWidth={1.75} />,
    },
    {
      key: "tasks",
      label: "Задачи",
      icon: <ListChecks size={14} strokeWidth={1.75} />,
      count: TASKS.length,
    },
    {
      key: "notes",
      label: "Заметки",
      icon: <StickyNote size={14} strokeWidth={1.75} />,
    },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        borderBottom: `1px solid ${T.borderSubtle}`,
        paddingBottom: 1,
      }}
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 14px",
              fontSize: 14,
              fontWeight: 500,
              color: isActive ? T.textPrimary : T.textSecondary,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            <span style={{ color: isActive ? T.accent : T.textTertiary }}>
              {t.icon}
            </span>
            {t.label}
            {typeof t.count === "number" && (
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: isActive ? T.accentMuted : T.bgOverlay,
                  color: isActive ? T.accent : T.textTertiary,
                }}
              >
                {t.count}
              </span>
            )}
            {isActive && (
              <motion.span
                layoutId="tab-indicator"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: -1,
                  height: 2,
                  background: T.accent,
                  borderRadius: 2,
                }}
                transition={SPRING}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function OverviewTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <StatsRow />
      <Card>
        <CardHeader title="Краткое содержание" />
        <p
          style={{
            margin: 0,
            fontSize: 15,
            lineHeight: 1.6,
            color: T.textPrimary,
            letterSpacing: "-0.005em",
          }}
        >
          Acme Corp заинтересованы в платформе Z для автоматизации
          sales-разборов и подготовки follow-up писем. Главный технический
          вопрос — интеграция с HubSpot и Clay; компромисс через webhook +
          Zapier на пилот. Compliance-блокер: SOC2 Type 2 и DPA. Бюджетный
          потолок — 500 000 ₽/мес при ROI за 3 месяца. Договорились о
          trial-доступе на 14 дней и последующем 90-дневном пилоте.
        </p>
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 16,
        }}
      >
        <ReportCard
          label="Боль клиента"
          value="Sales-разборы делаются вручную, занимают 4-6 часов на rep в неделю. Качество follow-up непостоянное."
        />
        <ReportCard
          label="Бюджет"
          value="350–500 000 ₽/мес. Принимается решением CTO + Head of RevOps."
        />
        <ReportCard
          label="ЛПР"
          value="Иван Колесников (CTO). Анна Лесникова (Head of RevOps) — co-decision-maker по revenue-фичам."
        />
        <ReportCard
          label="Срочность"
          value="Q2 2026 — закрыть sales-tooling-проект. Конкуренты на review: Gong, Avoma, Otter Business."
        />
      </div>

      <ReportCard
        label="Возражения"
        value={
          "Совместимость с HubSpot и Clay — нужна стабильная синхронизация. SOC2 Type 2 обязателен. Опасения по data-residency для записей звонков."
        }
      />

      <FollowUpCard />
    </div>
  );
}

function StatsRow() {
  const items = [
    { label: "Главы", value: CHAPTERS.length },
    { label: "Задачи", value: TASKS.length },
    { label: "Клипы", value: HIGHLIGHTS.length },
    { label: "Длительность", value: fmtTime(MEETING.durationMs) },
    { label: "Версия отчёта", value: `v${MEETING.recapVersion}` },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
        gap: 1,
        background: T.borderSubtle,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${T.borderSubtle}`,
      }}
    >
      {items.map((it) => (
        <div
          key={it.label}
          style={{ padding: "14px 18px", background: T.bgCard }}
        >
          <div
            style={{
              fontSize: 11,
              color: T.textTertiary,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {it.label}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 18,
              fontWeight: 600,
              color: T.textPrimary,
              fontVariantNumeric: "tabular-nums",
              fontFamily:
                typeof it.value === "string" && it.value.includes(":")
                  ? T.fontMono
                  : T.fontSans,
            }}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div
        style={{
          fontSize: 11,
          color: T.textTertiary,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, color: T.textPrimary, lineHeight: 1.55 }}>
        {value}
      </div>
    </Card>
  );
}

function FollowUpCard() {
  const [copied, setCopied] = useState(false);
  const text = `Иван, Анна, спасибо за встречу.

Резюмирую договорённости:
1. Trial-доступ на 14 дней — заведу до завтра.
2. Пилотный SOW с 90-дневным ROI-окном — пришлю до 13 мая.
3. SOC2 Type 2 statement и DPA — подготовлю в одном пакете до 15 мая.
4. Webhook-payload пример для HubSpot — отдельным письмом до 10 мая.

Если будут вопросы по trial — пишите Виктору в Slack.

— Сергей`;
  return (
    <Card>
      <CardHeader
        title="Follow-up письмо"
        accessory={
          <ButtonOutline
            icon={
              copied ? (
                <Check size={14} strokeWidth={1.75} />
              ) : (
                <Copy size={14} strokeWidth={1.75} />
              )
            }
            onClick={() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? "Скопировано" : "Скопировать"}
          </ButtonOutline>
        }
      />
      <pre
        style={{
          margin: 0,
          padding: 16,
          background: T.bgBase,
          border: `1px solid ${T.borderSubtle}`,
          borderRadius: 10,
          fontFamily: T.fontMono,
          fontSize: 12.5,
          lineHeight: 1.6,
          color: T.textPrimary,
          whiteSpace: "pre-wrap",
          overflow: "auto",
        }}
      >
        {text}
      </pre>
    </Card>
  );
}

function ChaptersTab({ onSeek }: { onSeek: (ms: number) => void }) {
  const [openId, setOpenId] = useState<string | null>("c3");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {CHAPTERS.map((c) => {
        const open = openId === c.id;
        return (
          <Card key={c.id} interactive>
            <button
              onClick={() => setOpenId(open ? null : c.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 16,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                textAlign: "left",
              }}
            >
              <div
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 12,
                  color: T.textTertiary,
                  width: 76,
                  flexShrink: 0,
                }}
              >
                {fmtTime(c.startMs)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    color: T.textPrimary,
                    letterSpacing: "-0.005em",
                  }}
                >
                  {c.title}
                </div>
                <div
                  style={{ marginTop: 4, fontSize: 13, color: T.textSecondary }}
                >
                  {c.summary}
                </div>
              </div>
              <ButtonGhost
                square
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(c.startMs);
                }}
                aria-label="Перейти"
              >
                <Play size={14} strokeWidth={1.75} style={{ marginLeft: 1 }} />
              </ButtonGhost>
            </button>
            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: "hidden" }}
                >
                  <div
                    style={{
                      marginTop: 16,
                      paddingTop: 16,
                      borderTop: `1px solid ${T.borderSubtle}`,
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <ul
                      style={{
                        margin: 0,
                        padding: 0,
                        listStyle: "none",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {[
                        "HubSpot и Clay — must-have для интеграции.",
                        "Webhook + Zapier как mvp-вариант принят.",
                        "SOC2 Type 2 — блокирующее условие.",
                      ].map((item, i) => (
                        <li
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            fontSize: 13.5,
                            color: T.textPrimary,
                            lineHeight: 1.55,
                          }}
                        >
                          <span style={{ color: T.accent, marginTop: 2 }}>
                            <Sparkles size={12} strokeWidth={2} />
                          </span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <AiCitation
                      data={{
                        startMs: 3_118_000,
                        speakerId: "u2",
                        text: "У нас compliance-отдел потребует SOC2 Type 2 и DPA до подписания контракта.",
                      }}
                      onJump={() => onSeek(3_118_000)}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        );
      })}
    </div>
  );
}

function TranscriptTab({
  currentMs,
  onSeek,
}: {
  currentMs: number;
  onSeek: (ms: number) => void;
}) {
  return (
    <Card noPadding>
      <div
        style={{
          padding: "16px 20px",
          borderBottom: `1px solid ${T.borderSubtle}`,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: T.bgBase,
            border: `1px solid ${T.borderSubtle}`,
            borderRadius: 8,
            padding: "6px 12px",
          }}
        >
          <span
            style={{
              fontFamily: T.fontMono,
              fontSize: 11,
              color: T.textTertiary,
              padding: "2px 6px",
              border: `1px solid ${T.borderSubtle}`,
              borderRadius: 4,
            }}
          >
            /
          </span>
          <input
            placeholder="Поиск в транскрипте"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: T.textPrimary,
              fontSize: 13,
              fontFamily: T.fontSans,
            }}
          />
        </div>
        <span style={{ fontSize: 12, color: T.textTertiary }}>
          {TRANSCRIPT.length} реплик
        </span>
      </div>
      <div style={{ maxHeight: 520, overflowY: "auto" }}>
        {TRANSCRIPT.map((u) => {
          const speaker = speakerById(u.speakerId);
          const isActive =
            currentMs >= u.startMs && currentMs < u.startMs + 30_000;
          return (
            <button
              key={u.id}
              onClick={() => onSeek(u.startMs)}
              style={{
                width: "100%",
                display: "flex",
                gap: 12,
                padding: "14px 20px",
                background: isActive ? T.bgOverlay : "transparent",
                border: "none",
                borderLeft: isActive
                  ? `2px solid ${T.accent}`
                  : "2px solid transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 160ms",
              }}
            >
              <Avatar
                initials={speaker?.initials ?? "??"}
                size={32}
                accent={speaker?.isHost}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: T.textPrimary,
                    }}
                  >
                    {speaker?.name}
                  </span>
                  <span
                    style={{
                      fontFamily: T.fontMono,
                      fontSize: 11,
                      color: T.textTertiary,
                    }}
                  >
                    {fmtTime(u.startMs)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: isActive ? T.textPrimary : T.textSecondary,
                    lineHeight: 1.55,
                  }}
                >
                  {u.text}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function TasksTab({ onSeek }: { onSeek: (ms: number) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {TASKS.map((t) => (
        <TaskRow key={t.id} task={t} onSeek={onSeek} />
      ))}
      <button
        style={{
          padding: "14px 16px",
          background: "transparent",
          border: `1px dashed ${T.border}`,
          borderRadius: 12,
          color: T.textSecondary,
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          fontFamily: T.fontSans,
        }}
      >
        <Plus size={14} strokeWidth={1.75} />
        Добавить задачу вручную
      </button>
    </div>
  );
}

function TaskRow({
  task,
  onSeek,
}: {
  task: (typeof TASKS)[number];
  onSeek: (ms: number) => void;
}) {
  const [open, setOpen] = useState(task.id === "t2");
  const [done, setDone] = useState(task.status === "done");
  return (
    <div
      style={{
        background: T.bgCard,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: 12,
      }}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 14,
          padding: 16,
          cursor: "pointer",
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDone((v) => !v);
          }}
          aria-label="Отметить выполненной"
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            border: `1.5px solid ${done ? T.accent : T.borderStrong}`,
            background: done ? T.accent : "transparent",
            color: T.bgBase,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            flexShrink: 0,
            marginTop: 2,
            transition: "all 200ms",
          }}
        >
          {done && <Check size={11} strokeWidth={3} />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: done ? T.textTertiary : T.textPrimary,
              textDecoration: done ? "line-through" : "none",
              letterSpacing: "-0.005em",
              lineHeight: 1.45,
            }}
          >
            {task.title}
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Chip>
              <span
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  color: T.textSecondary,
                }}
              >
                {task.assignee}
              </span>
            </Chip>
            <Chip>
              <span style={{ fontSize: 11, color: T.textSecondary }}>
                {task.dueDate}
              </span>
            </Chip>
            <Chip>
              <span style={{ fontSize: 11, color: T.textTertiary }}>
                уверенность
              </span>
              <ConfidenceDots value={task.confidence} />
            </Chip>
            {task.status === "in_progress" && (
              <Chip tone="warning">
                <span style={{ fontSize: 11, color: T.warning }}>в работе</span>
              </Chip>
            )}
          </div>
        </div>
        <ButtonGhost square aria-label="Меню задачи">
          <MoreHorizontal size={16} strokeWidth={1.75} />
        </ButtonGhost>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                padding: "0 16px 16px 48px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <AiCitation
                data={{
                  startMs: task.sourceMs,
                  speakerId: PARTICIPANTS[1].id,
                  text: task.sourceQuote,
                }}
                onJump={() => onSeek(task.sourceMs)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <ButtonOutline
                  icon={<ArrowUpRight size={14} strokeWidth={1.75} />}
                >
                  Отправить в...
                </ButtonOutline>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConfidenceDots({ value }: { value: number }) {
  const filled = value >= 0.7 ? 3 : value >= 0.4 ? 2 : 1;
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: i < filled ? T.accent : "transparent",
            border: `1px solid ${i < filled ? T.accent : T.borderStrong}`,
          }}
        />
      ))}
    </span>
  );
}

function NotesTab() {
  const [text, setText] = useState(
    "Acme — серьёзный кандидат. Главный риск: SOC2 пакет. Виктор может ускорить compliance-pack из своего опыта.\n\nЧто проверить до пилотa:\n— что наш HubSpot-коннектор покрывает Custom Objects;\n— что Clay не блокирует наши IP в их sandbox.",
  );
  const [savedAt, setSavedAt] = useState("сейчас");
  return (
    <Card>
      <CardHeader
        title="Заметки хоста"
        accessory={
          <span style={{ fontSize: 11, color: T.textTertiary }}>
            сохранено · {savedAt}
          </span>
        }
      />
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSavedAt("сейчас");
        }}
        style={{
          width: "100%",
          minHeight: 220,
          background: T.bgBase,
          border: `1px solid ${T.borderSubtle}`,
          borderRadius: 10,
          padding: 14,
          fontFamily: T.fontSans,
          fontSize: 14,
          color: T.textPrimary,
          lineHeight: 1.6,
          resize: "vertical",
          outline: "none",
        }}
      />
    </Card>
  );
}

function RightColumn({
  open,
  onOpen,
  onClose,
  history,
  input,
  onInput,
  onSend,
  thinking,
  onSeek,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  history: AiMessage[];
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  thinking: boolean;
  onSeek: (ms: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [history.length, thinking]);

  if (!open) {
    return (
      <button
        onClick={onOpen}
        aria-label="AI-помощник"
        style={{
          position: "sticky",
          top: 96,
          alignSelf: "start",
          width: 56,
          height: 56,
          borderRadius: 14,
          border: `1px solid ${T.accentBorder}`,
          background: T.accentMuted,
          color: T.accent,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          backdropFilter: "blur(8px)",
        }}
      >
        <Sparkles size={20} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <aside
      style={{
        position: "sticky",
        top: 96,
        alignSelf: "start",
        height: "calc(100vh - 120px)",
        display: "flex",
        flexDirection: "column",
        background: T.bgCard,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: `1px solid ${T.borderSubtle}`,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: T.accentMuted,
            color: T.accent,
            display: "grid",
            placeItems: "center",
          }}
        >
          <Sparkles size={14} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: T.textPrimary }}>
            AI-помощник
          </div>
          <div style={{ fontSize: 11, color: T.textTertiary }}>
            контекст · эта встреча
          </div>
        </div>
        <ButtonGhost square onClick={onClose} aria-label="Закрыть">
          <X size={16} strokeWidth={1.75} />
        </ButtonGhost>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {history.map((m) => (
          <ChatMessage key={m.id} msg={m} onSeek={onSeek} />
        ))}
        <AnimatePresence>{thinking && <AiTypingDots />}</AnimatePresence>
      </div>

      <div
        style={{
          padding: "12px 12px 14px",
          borderTop: `1px solid ${T.borderSubtle}`,
        }}
      >
        {history.length === 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 10,
            }}
          >
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => onInput(p)}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: T.bgOverlay,
                  border: `1px solid ${T.borderSubtle}`,
                  color: T.textSecondary,
                  cursor: "pointer",
                  fontFamily: T.fontSans,
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            background: T.bgOverlay,
            border: `1px solid ${T.borderSubtle}`,
            borderRadius: 12,
            padding: 8,
          }}
        >
          <textarea
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Спросите что-нибудь про эту встречу..."
            rows={1}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: T.textPrimary,
              fontSize: 13,
              fontFamily: T.fontSans,
              lineHeight: 1.5,
              padding: "6px 8px",
              resize: "none",
              maxHeight: 120,
            }}
          />
          <button
            onClick={onSend}
            disabled={!input.trim()}
            aria-label="Отправить"
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              background: input.trim() ? T.accent : T.bgCard,
              color: input.trim() ? T.bgBase : T.textTertiary,
              border: "none",
              display: "grid",
              placeItems: "center",
              cursor: input.trim() ? "pointer" : "default",
              transition: "all 160ms",
              boxShadow: input.trim() ? T.accentGlow : "none",
            }}
          >
            <Send size={14} strokeWidth={2} style={{ marginLeft: -1 }} />
          </button>
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 10,
            color: T.textTertiary,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Enter — отправить · Shift+Enter — новая строка</span>
          <span style={{ fontFamily: T.fontMono }}>Claude Sonnet 4.6</span>
        </div>
      </div>
    </aside>
  );
}

function ChatMessage({
  msg,
  onSeek,
}: {
  msg: AiMessage;
  onSeek: (ms: number) => void;
}) {
  if (msg.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        style={{ display: "flex", justifyContent: "flex-end" }}
      >
        <div
          style={{
            maxWidth: "85%",
            background: T.bgOverlay,
            color: T.textPrimary,
            borderRadius: 14,
            borderTopRightRadius: 4,
            padding: "10px 14px",
            fontSize: 13.5,
            lineHeight: 1.5,
            border: `1px solid ${T.borderSubtle}`,
          }}
        >
          {msg.content}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: T.accentMuted,
            color: T.accent,
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <Sparkles size={12} strokeWidth={1.75} />
        </div>
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            color: T.textPrimary,
            paddingTop: 1,
          }}
        >
          {msg.content}
        </div>
      </div>
      {msg.citations && msg.citations.length > 0 && (
        <div
          style={{
            marginLeft: 32,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {msg.citations.map((c, i) => (
            <AiCitation key={i} data={c} onJump={() => onSeek(c.startMs)} />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function AiCitation({
  data,
  onJump,
}: {
  data: AiCitationData;
  onJump: () => void;
}) {
  const speaker = speakerById(data.speakerId);
  return (
    <motion.button
      onClick={onJump}
      whileHover={{ scale: 1.015 }}
      transition={SPRING}
      style={{
        textAlign: "left",
        width: "100%",
        background: T.accentMuted,
        backdropFilter: "blur(12px) saturate(1.4)",
        WebkitBackdropFilter: "blur(12px) saturate(1.4)",
        border: `1px solid ${T.accentBorder}`,
        borderRadius: 12,
        padding: 14,
        cursor: "pointer",
        boxShadow: "none",
        position: "relative",
        overflow: "hidden",
      }}
      className="ai-citation"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = T.accentGlow;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          fontFamily: T.fontMono,
          fontSize: 11,
          color: T.accent,
        }}
      >
        <span>{fmtTime(data.startMs)}</span>
        <span style={{ color: T.accentBorder }}>·</span>
        <span style={{ color: T.textSecondary }}>
          {speaker?.name ?? data.speakerId}
        </span>
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: T.textPrimary,
          fontStyle: "italic",
        }}
      >
        «{data.text}»
      </div>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 500,
          color: T.accent,
        }}
      >
        <Play size={11} strokeWidth={2} />
        Перейти к моменту
      </div>
    </motion.button>
  );
}

function AiTypingDots() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 32 }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: T.accent,
              display: "inline-block",
            }}
            animate={{ y: [0, -4, 0] }}
            transition={{
              duration: 0.6,
              repeat: Infinity,
              delay: i * 0.12,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 11, color: T.textTertiary }}>думает...</span>
    </motion.div>
  );
}

function Card({
  children,
  noPadding,
  interactive,
}: {
  children: React.ReactNode;
  noPadding?: boolean;
  interactive?: boolean;
}) {
  return (
    <div
      style={{
        background: T.bgCard,
        border: `1px solid ${T.borderSubtle}`,
        borderRadius: 14,
        padding: noPadding ? 0 : 20,
        transition: interactive
          ? "border-color 160ms, background 160ms"
          : undefined,
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  title,
  accessory,
}: {
  title: string;
  accessory?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          color: T.textPrimary,
          letterSpacing: "-0.005em",
        }}
      >
        {title}
      </h3>
      {accessory}
    </div>
  );
}

function ButtonOutline({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        background: T.accentMuted,
        color: T.accent,
        border: `1px solid ${T.accentBorder}`,
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        fontFamily: T.fontSans,
        cursor: "pointer",
        transition: "background 160ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = T.accentMutedStrong;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = T.accentMuted;
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function ButtonGhost({
  children,
  square,
  onClick,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { square?: boolean }) {
  return (
    <button
      onClick={onClick}
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: square ? 32 : undefined,
        height: 32,
        padding: square ? 0 : "0 10px",
        background: "transparent",
        color: T.textSecondary,
        border: "none",
        borderRadius: 8,
        fontSize: 13,
        cursor: "pointer",
        transition: "background 120ms, color 120ms",
        fontFamily: T.fontSans,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = T.bgOverlay;
        (e.currentTarget as HTMLElement).style.color = T.textPrimary;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
        (e.currentTarget as HTMLElement).style.color = T.textSecondary;
      }}
    >
      {children}
    </button>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "mint";
}) {
  const isMint = tone === "mint";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.02em",
        background: isMint ? T.accentMuted : T.bgOverlay,
        color: isMint ? T.accent : T.textSecondary,
        border: `1px solid ${isMint ? T.accentBorder : T.borderSubtle}`,
      }}
    >
      {children}
    </span>
  );
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: 6,
        background: T.bgBase,
        border: `1px solid ${tone === "warning" ? "rgba(251,191,36,0.28)" : T.borderSubtle}`,
      }}
    >
      {children}
    </span>
  );
}

function Avatar({
  initials,
  size = 32,
  accent,
}: {
  initials: string;
  size?: number;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: accent ? T.accentMuted : T.bgOverlay,
        color: accent ? T.accent : T.textSecondary,
        display: "grid",
        placeItems: "center",
        fontSize: Math.max(11, size * 0.36),
        fontWeight: 500,
        letterSpacing: "0.02em",
        border: `1px solid ${accent ? T.accentBorder : T.borderSubtle}`,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

export default MeetingResultPage;
