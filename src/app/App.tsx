import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  Mic,
  Trophy,
  UserPlus,
  User as UserIcon,
  Flame,
  SlidersHorizontal,
  Search,
  X,
  ChevronRight,
  Medal,
  Star,
  Clock,
  Zap,
  Volume2,
  PhoneOff,
  Crown,
  Target,
  MapPin,
  Copy,
  Share2,
  CheckCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

import {
  api,
  ApiError,
  BOT_USERNAME,
  type User,
  type Partner,
  type SessionHistoryItem,
  type Leaderboard,
} from "./api";

// ---------------------------------------------------------------------------
// Telegram WebApp shim
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        ready: () => void;
        expand: () => void;
        close: () => void;
        openTelegramLink?: (url: string) => void;
        BackButton: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
        HapticFeedback: {
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          notificationOccurred: (type: "error" | "success" | "warning") => void;
          selectionChanged: () => void;
        };
        themeParams: { bg_color?: string; text_color?: string };
        initDataUnsafe?: { user?: { first_name?: string; username?: string; photo_url?: string } };
      };
    };
  }
}

function useTelegram() {
  const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
  useEffect(() => {
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, [tg]);
  const haptic = useCallback(
    (style: "light" | "medium" | "heavy" = "light") => {
      tg?.HapticFeedback?.impactOccurred(style);
    },
    [tg]
  );
  const hapticNotify = useCallback(
    (type: "error" | "success" | "warning" = "success") => {
      tg?.HapticFeedback?.notificationOccurred(type);
    },
    [tg]
  );
  return { tg, haptic, hapticNotify };
}

// ---------------------------------------------------------------------------
// Types & utilities
// ---------------------------------------------------------------------------
type NavTab = "speaking" | "leaderboard" | "invite" | "profile";
type LeaderTab = "speakers" | "streak";

function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

const AVATAR_COLORS = [
  "#f97316", "#8b5cf6", "#06b6d4", "#ec4899",
  "#10b981", "#f59e0b", "#ef4444", "#3b82f6",
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function minutesFromSec(sec: number): number {
  if (sec <= 0) return 0;
  return Math.max(1, Math.round(sec / 60));
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(diff)) return "";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yesterday";
  return `${day}d ago`;
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function levelLabel(level: string | null): string {
  return level ? level.toUpperCase() : "—";
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------
function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-14 h-14 text-base" };
  return (
    <div
      className={cn("rounded-full flex items-center justify-center font-bold text-white flex-shrink-0", sizes[size])}
      style={{ backgroundColor: colorFor(name) }}
    >
      {initialsOf(name)}
    </div>
  );
}

function PulseRing({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <>
      <span className="absolute inset-0 rounded-full bg-orange-500/30 animate-ping" style={{ animationDuration: "1.2s" }} />
      <span className="absolute -inset-4 rounded-full bg-orange-500/15 animate-ping" style={{ animationDuration: "1.8s", animationDelay: "0.3s" }} />
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="dark fixed inset-0 bg-background flex flex-col items-center justify-center px-8 text-center gap-4" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Speaking (main)
// ---------------------------------------------------------------------------
function SpeakingScreen({
  user,
  history,
  onFindPartner,
}: {
  user: User;
  history: SessionHistoryItem[];
  onFindPartner: () => void;
}) {
  const { haptic } = useTelegram();
  const [micActive, setMicActive] = useState(false);
  const recent = history.filter((s) => s.end_time).slice(0, 2);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-secondary rounded-full px-3 py-1.5">
            <Clock className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-xs font-semibold text-white">{user.total_minutes} min</span>
          </div>
          <div className="flex items-center gap-1.5 bg-secondary rounded-full px-3 py-1.5">
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-xs font-semibold text-white">{user.streak}</span>
          </div>
        </div>

        <div className="bg-orange-500/15 border border-orange-500/30 rounded-full px-3 py-1">
          <span className="text-xs font-bold text-orange-400 tracking-wide">{levelLabel(user.level)}</span>
        </div>
      </div>

      {/* Center mic area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
        <div className="relative flex items-center justify-center">
          <div className={cn("absolute w-64 h-64 rounded-full border transition-all duration-500", micActive ? "border-orange-500/30 scale-110" : "border-white/5")} />
          <div className={cn("absolute w-48 h-48 rounded-full border transition-all duration-500", micActive ? "border-orange-500/20 scale-105" : "border-white/8")} />

          <button
            onPointerDown={() => { setMicActive(true); haptic("medium"); }}
            onPointerUp={() => { setMicActive(false); onFindPartner(); }}
            onPointerLeave={() => setMicActive(false)}
            className={cn(
              "relative w-36 h-36 rounded-full flex items-center justify-center",
              "bg-gradient-to-br from-orange-400 to-orange-600 transition-transform duration-150",
              micActive ? "scale-95" : "scale-100"
            )}
            style={{
              boxShadow: micActive
                ? "0 0 60px rgba(249,115,22,0.5), 0 8px 40px rgba(0,0,0,0.5)"
                : "0 0 40px rgba(249,115,22,0.3), 0 8px 32px rgba(0,0,0,0.4)",
            }}
          >
            <PulseRing active={micActive} />
            <Mic className="w-16 h-16 text-white" strokeWidth={1.5} />
          </button>
        </div>

        <div className="text-center space-y-1">
          <p className="text-white font-semibold text-base">Tap to find a partner</p>
          <p className="text-muted-foreground text-xs">We'll connect you with someone to practice with</p>
        </div>
      </div>

      {/* Recent sessions */}
      <div className="px-4 pb-2">
        <h3 className="text-sm font-semibold text-white mb-2">Recent Sessions</h3>
        {recent.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-4 text-center">
            <p className="text-xs text-muted-foreground">No sessions yet. Tap the mic to start your first one.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((s) => {
              const partner = s.partner_name ?? "Partner";
              return (
                <div key={s.id} className="bg-card rounded-2xl p-3 flex items-center gap-3 border border-border">
                  <Avatar name={partner} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{partner}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.topic ?? "Practice"}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-semibold text-orange-400">{minutesFromSec(s.duration_sec)} min</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(s.start_time)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Finding Partner (starts a real session)
// ---------------------------------------------------------------------------
function FindingPartnerScreen({
  onMatched,
  onCancel,
  onError,
}: {
  onMatched: (sessionId: number, partner: Partner) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const { haptic } = useTelegram();
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const interval = setInterval(() => setDots((d) => (d.length >= 3 ? "." : d + ".")), 500);
    return () => clearInterval(interval);
  }, []);

  // Kick off the real session; keep a small floor so the animation reads well.
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    api
      .startSession()
      .then((res) => {
        const wait = Math.max(0, 1200 - (Date.now() - startedAt));
        setTimeout(() => {
          if (cancelled) {
            // User left while we were matching: close the dangling session.
            api.endSession(res.session_id).catch(() => {});
            return;
          }
          haptic("heavy");
          onMatched(res.session_id, res.partner);
        }, wait);
      })
      .catch((e) => {
        if (cancelled) return;
        onError(e instanceof ApiError ? e.message : "Could not find a partner");
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-8">
      <div className="relative flex items-center justify-center">
        <div className="absolute w-56 h-56 rounded-full border border-orange-500/10 animate-ping" style={{ animationDuration: "2s" }} />
        <div className="absolute w-44 h-44 rounded-full border border-orange-500/15 animate-ping" style={{ animationDuration: "2.5s", animationDelay: "0.5s" }} />
        <div
          className="w-28 h-28 rounded-full flex items-center justify-center"
          style={{ background: "radial-gradient(circle at 35% 35%, #fb923c, #f97316, #ea580c)", boxShadow: "0 0 50px rgba(249,115,22,0.4), 0 8px 32px rgba(0,0,0,0.5)" }}
        >
          <Search className="w-14 h-14 text-white" strokeWidth={1.5} />
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-2xl font-bold text-white">Finding a Partner{dots}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">Looking for someone at your level to practice with</p>
      </div>

      <button
        onClick={() => { haptic("light"); onCancel(); }}
        className="flex items-center gap-2 bg-secondary border border-border rounded-2xl px-6 py-3 text-sm font-semibold text-white"
      >
        <X className="w-4 h-4" />
        Cancel
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Call (live session, tracks duration, ends via API)
// ---------------------------------------------------------------------------
function CallScreen({
  partner,
  sessionId,
  onEnd,
}: {
  partner: Partner;
  sessionId: number;
  onEnd: (sessionId: number) => Promise<void>;
}) {
  const { haptic, hapticNotify } = useTelegram();
  const [elapsed, setElapsed] = useState(0);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const handleEnd = async () => {
    if (ending) return;
    setEnding(true);
    haptic("heavy");
    await onEnd(sessionId);
    hapticNotify("success");
  };

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-8">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <Avatar name={partner.display_name} size="lg" />
          <span className="absolute inset-0 rounded-full border-2 border-orange-500/40 animate-ping" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{partner.display_name}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {partner.topic} · {partner.accent} accent{partner.is_ai ? " · AI tutor" : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="text-4xl font-bold text-white tabular-nums">{fmtClock(elapsed)}</span>
        <span className="text-xs text-muted-foreground">Speaking time</span>
      </div>

      <button
        onClick={handleEnd}
        disabled={ending}
        className="flex items-center gap-2 bg-red-500 disabled:opacity-60 rounded-full px-8 py-4 text-sm font-bold text-white"
        style={{ boxShadow: "0 8px 32px rgba(239,68,68,0.35)" }}
      >
        {ending ? <Loader2 className="w-5 h-5 animate-spin" /> : <PhoneOff className="w-5 h-5" />}
        {ending ? "Ending…" : "End Call"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Leaderboard
// ---------------------------------------------------------------------------
function LeaderboardScreen() {
  const { haptic } = useTelegram();
  const [activeTab, setActiveTab] = useState<LeaderTab>("speakers");
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.leaderboard()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "Failed to load"));
    return () => { alive = false; };
  }, []);

  const tabs: { id: LeaderTab; label: string }[] = [
    { id: "speakers", label: "Top Speakers" },
    { id: "streak", label: "Streak" },
  ];

  const rows = data
    ? [...data.week].sort((a, b) => (activeTab === "streak" ? b.streak - a.streak : b.minutes - a.minutes))
    : [];

  const valueOf = (r: Leaderboard["week"][number]) =>
    activeTab === "streak" ? `${r.streak} days` : `${r.minutes.toLocaleString()} min`;

  const meInTop = rows.some((r) => r.is_me);
  const medalColors = ["#f59e0b", "#94a3b8", "#b45309"];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-6 h-6 text-orange-400" />
          <h1 className="text-xl font-bold text-white">Leaderboard</h1>
        </div>
        <div className="bg-secondary rounded-2xl p-1 flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); haptic("light"); }}
              className={cn(
                "flex-1 py-2 text-xs font-semibold rounded-xl transition-all duration-200",
                activeTab === tab.id ? "bg-orange-500 text-white shadow-sm" : "text-muted-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="px-4 text-sm text-red-400">{error}</p>}

      {!error && rows.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-8 text-center">
          <p className="text-sm text-muted-foreground">
            {data ? "No one has practiced this week yet. Be the first!" : "Loading…"}
          </p>
        </div>
      )}

      {rows.length >= 3 && (
        <div className="px-4 pb-4">
          <div className="flex items-end justify-center gap-3 h-28">
            {/* 2nd */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <Avatar name={rows[1].name} size="md" />
              <p className="text-xs font-semibold text-white truncate w-full text-center">{rows[1].name.split(" ")[0]}</p>
              <div className="w-full rounded-t-xl flex items-center justify-center h-16" style={{ background: "linear-gradient(180deg, #475569 0%, #334155 100%)" }}>
                <Medal className="w-5 h-5" style={{ color: medalColors[1] }} />
              </div>
            </div>
            {/* 1st */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <Crown className="w-5 h-5 text-amber-400" />
              <Avatar name={rows[0].name} size="lg" />
              <p className="text-xs font-semibold text-white truncate w-full text-center">{rows[0].name.split(" ")[0]}</p>
              <div className="w-full rounded-t-xl flex items-center justify-center h-24" style={{ background: "linear-gradient(180deg, #f97316 0%, #ea580c 100%)" }}>
                <Medal className="w-6 h-6" style={{ color: medalColors[0] }} />
              </div>
            </div>
            {/* 3rd */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <Avatar name={rows[2].name} size="md" />
              <p className="text-xs font-semibold text-white truncate w-full text-center">{rows[2].name.split(" ")[0]}</p>
              <div className="w-full rounded-t-xl flex items-center justify-center h-12" style={{ background: "linear-gradient(180deg, #92400e 0%, #78350f 100%)" }}>
                <Medal className="w-4 h-4" style={{ color: medalColors[2] }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-2">
          {rows.map((r, index) => (
            <div
              key={r.telegram_id}
              className={cn(
                "rounded-2xl p-3 flex items-center gap-3 border",
                r.is_me ? "bg-orange-500/10 border-orange-500/30" : "bg-card border-border"
              )}
            >
              <span className={cn(
                "w-7 text-center text-sm font-bold flex-shrink-0",
                index === 0 ? "text-amber-400" : index === 1 ? "text-slate-400" : index === 2 ? "text-amber-700" : "text-muted-foreground"
              )}>
                {index + 1}
              </span>
              <Avatar name={r.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{r.is_me ? "You" : r.name}</p>
                {r.username && <p className="text-xs text-muted-foreground truncate">@{r.username}</p>}
              </div>
              <span className="text-sm font-bold text-orange-400 flex-shrink-0">{valueOf(r)}</span>
            </div>
          ))}

          {/* Current user, if outside the visible list */}
          {!meInTop && data?.me && (
            <div className="border-t border-border pt-2 mt-2">
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-3 flex items-center gap-3">
                <span className="w-7 text-center text-sm font-bold text-muted-foreground flex-shrink-0">{data.me.rank}</span>
                <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
                  <UserIcon className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">You</p>
                  <p className="text-xs text-muted-foreground">Keep going! 🔥</p>
                </div>
                <span className="text-sm font-bold text-orange-400 flex-shrink-0">{data.me.minutes} min</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Invite
// ---------------------------------------------------------------------------
function InviteScreen({ user }: { user: User }) {
  const { tg, haptic, hapticNotify } = useTelegram();
  const [copied, setCopied] = useState(false);
  const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${user.telegram_id}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(refLink).catch(() => {});
    setCopied(true);
    hapticNotify("success");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    haptic("medium");
    const url = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("Practice speaking English with me on SpeakUp!")}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
  };

  return (
    <div className="flex flex-col h-full px-4 pt-6 gap-6">
      <div className="bg-gradient-to-br from-orange-500/20 via-orange-500/10 to-transparent border border-orange-500/20 rounded-3xl p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-orange-500 flex items-center justify-center mx-auto mb-4">
          <UserPlus className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Invite friends</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Share your link so friends can join SpeakUp and practice speaking with you.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-white">Your referral link</p>
        <div className="bg-card border border-border rounded-2xl p-3 flex items-center gap-3">
          <p className="flex-1 text-xs text-muted-foreground truncate font-mono">{refLink}</p>
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition-all",
              copied ? "bg-green-500/20 text-green-400" : "bg-orange-500 text-white"
            )}
          >
            {copied ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <button
          onClick={handleShare}
          className="w-full flex items-center justify-center gap-2 bg-secondary border border-border rounded-2xl py-3.5 text-sm font-semibold text-white"
        >
          <Share2 className="w-4 h-4 text-orange-400" />
          Share via Telegram
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-white">How it works</p>
        {[
          { step: "1", text: "Share your unique link with friends" },
          { step: "2", text: "They open SpeakUp using your link" },
          { step: "3", text: "Practice together and climb the leaderboard" },
        ].map((item) => (
          <div key={item.step} className="flex items-center gap-3 bg-card border border-border rounded-2xl p-3">
            <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">{item.step}</span>
            </div>
            <p className="text-sm text-muted-foreground">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Profile
// ---------------------------------------------------------------------------
function ProfileScreen({ user }: { user: User }) {
  const displayName = user.first_name ?? user.username ?? "You";
  const username = user.username ? `@${user.username}` : `id ${user.telegram_id}`;

  const stats = [
    { label: "Total Minutes", value: `${user.total_minutes}`, icon: <Clock className="w-4 h-4 text-orange-400" /> },
    { label: "Sessions", value: `${user.total_sessions}`, icon: <Mic className="w-4 h-4 text-orange-400" /> },
    { label: "Streak", value: `${user.streak} days`, icon: <Flame className="w-4 h-4 text-orange-400" /> },
    { label: "Level", value: user.level ? user.level[0].toUpperCase() + user.level.slice(1) : "—", icon: <Star className="w-4 h-4 text-orange-400" /> },
  ];

  const profileRows = [
    { icon: <Target className="w-4 h-4" />, label: "Goal", sub: user.goal ?? "Not set" },
    { icon: <Zap className="w-4 h-4" />, label: "Main challenge", sub: user.challenge ? user.challenge[0].toUpperCase() + user.challenge.slice(1) : "Not set" },
    { icon: <Volume2 className="w-4 h-4" />, label: "Practice frequency", sub: user.frequency ?? "Not set" },
    { icon: <MapPin className="w-4 h-4" />, label: "Location", sub: user.location ?? "Not set" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-gradient-to-b from-orange-500/10 to-transparent px-4 pt-6 pb-4 flex flex-col items-center gap-3">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white"
          style={{ background: "linear-gradient(135deg, #f97316, #ea580c)" }}
        >
          {initialsOf(displayName)}
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold text-white">{displayName}</h2>
          <p className="text-sm text-muted-foreground">{username}</p>
        </div>
        <div className="bg-orange-500/15 border border-orange-500/30 rounded-full px-4 py-1.5">
          <span className="text-xs font-bold text-orange-400">{levelLabel(user.level)}</span>
        </div>
      </div>

      <div className="px-4 grid grid-cols-2 gap-3 pb-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              {stat.icon}
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
            <p className="text-xl font-bold text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="px-4 space-y-2 flex-1 overflow-y-auto pb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-3">My profile</p>
        {profileRows.map((item) => (
          <div key={item.label} className="w-full bg-card border border-border rounded-2xl p-3.5 flex items-center gap-3 text-left">
            <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-orange-400 flex-shrink-0">
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom Navigation
// ---------------------------------------------------------------------------
const NAV_ITEMS: { id: NavTab; label: string; icon: (active: boolean) => JSX.Element }[] = [
  { id: "speaking", label: "Speaking", icon: (a) => <Mic className={cn("w-5 h-5", a ? "text-orange-400" : "text-muted-foreground")} /> },
  { id: "leaderboard", label: "Leaderboard", icon: (a) => <Trophy className={cn("w-5 h-5", a ? "text-orange-400" : "text-muted-foreground")} /> },
  { id: "invite", label: "Invite", icon: (a) => <UserPlus className={cn("w-5 h-5", a ? "text-orange-400" : "text-muted-foreground")} /> },
  { id: "profile", label: "Profile", icon: (a) => <UserIcon className={cn("w-5 h-5", a ? "text-orange-400" : "text-muted-foreground")} /> },
];

function BottomNav({ active, onChange }: { active: NavTab; onChange: (tab: NavTab) => void }) {
  const { haptic } = useTelegram();
  return (
    <nav className="flex-shrink-0 border-t border-border bg-card safe-area-bottom">
      <div className="flex">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              onClick={() => { haptic("light"); onChange(item.id); }}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-all duration-150 relative"
            >
              {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-orange-500 rounded-full" />}
              {item.icon(isActive)}
              <span className={cn("text-[10px] font-medium", isActive ? "text-orange-400" : "text-muted-foreground")}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------
type Phase = "loading" | "error" | "ready";

export default function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);

  const [activeNav, setActiveNav] = useState<NavTab>("speaking");
  const [finding, setFinding] = useState(false);
  const [call, setCall] = useState<{ sessionId: number; partner: Partner } | null>(null);
  const findingRef = useRef(false);

  // Theme / layout setup.
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.fontFamily = "'Inter', system-ui, sans-serif";
    document.body.style.overflow = "hidden";
    document.body.style.background = "#111111";
  }, []);

  const loadAll = useCallback(async () => {
    // Sequential: getMe upserts + commits the user row first, so a concurrent
    // history call can't race it into a duplicate-insert on first load.
    const me = await api.getMe();
    setUser(me);
    const hist = await api.history().catch(() => []);
    setHistory(hist);
  }, []);

  useEffect(() => {
    loadAll()
      .then(() => setPhase("ready"))
      .catch((e) => {
        setErrorMsg(e instanceof ApiError ? e.message : "Could not reach the server");
        setPhase("error");
      });
  }, [loadAll]);

  // Telegram BackButton during finding / call.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    const show = finding;
    if (show) {
      tg.BackButton.show();
      const cb = () => setFinding(false);
      tg.BackButton.onClick(cb);
      return () => { tg.BackButton.offClick(cb); tg.BackButton.hide(); };
    }
    tg.BackButton.hide();
  }, [finding]);

  const handleEndCall = useCallback(async (sessionId: number) => {
    try {
      await api.endSession(sessionId);
    } catch {
      /* surface nothing destructive; still refresh below */
    }
    setCall(null);
    await loadAll().catch(() => {});
  }, [loadAll]);

  // ---- Render gates ----
  if (phase === "loading") {
    return (
      <Centered>
        <Loader2 className="w-10 h-10 text-orange-400 animate-spin" />
        <p className="text-sm text-muted-foreground">Loading SpeakUp…</p>
      </Centered>
    );
  }

  if (phase === "error" || !user) {
    return (
      <Centered>
        <div className="w-14 h-14 rounded-2xl bg-red-500/15 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-400" />
        </div>
        <h1 className="text-lg font-bold text-white">Can't load your profile</h1>
        <p className="text-sm text-muted-foreground max-w-xs">{errorMsg}</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Open this app from the SpeakUp Telegram bot (the “Find Partner” button) so it can verify your account.
        </p>
        <button
          onClick={() => { setPhase("loading"); loadAll().then(() => setPhase("ready")).catch((e) => { setErrorMsg(e instanceof ApiError ? e.message : "Could not reach the server"); setPhase("error"); }); }}
          className="bg-orange-500 text-white text-sm font-semibold px-6 py-3 rounded-2xl"
        >
          Try again
        </button>
      </Centered>
    );
  }

  // ---- Call overlay ----
  if (call) {
    return (
      <div className="dark fixed inset-0 bg-background flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <CallScreen partner={call.partner} sessionId={call.sessionId} onEnd={handleEndCall} />
      </div>
    );
  }

  // ---- Finding overlay ----
  if (finding) {
    return (
      <div className="dark fixed inset-0 bg-background flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <FindingPartnerScreen
          onMatched={(sessionId, partner) => { findingRef.current = false; setFinding(false); setCall({ sessionId, partner }); }}
          onCancel={() => { findingRef.current = false; setFinding(false); }}
          onError={(msg) => { findingRef.current = false; setFinding(false); setErrorMsg(msg); }}
        />
      </div>
    );
  }

  const renderMain = () => {
    switch (activeNav) {
      case "speaking":
        return <SpeakingScreen user={user} history={history} onFindPartner={() => { if (!findingRef.current) { findingRef.current = true; setFinding(true); } }} />;
      case "leaderboard":
        return <LeaderboardScreen />;
      case "invite":
        return <InviteScreen user={user} />;
      case "profile":
        return <ProfileScreen user={user} />;
    }
  };

  return (
    <div className="dark fixed inset-0 bg-background flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ WebkitOverflowScrolling: "touch" }}>
        {renderMain()}
      </div>
      <BottomNav active={activeNav} onChange={setActiveNav} />
    </div>
  );
}
