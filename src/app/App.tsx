import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  Mic,
  MicOff,
  Trophy,
  UserPlus,
  User as UserIcon,
  Flame,
  Search,
  X,
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
  Sun,
  Moon,
  Smartphone,
  Gift,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  ImagePlus,
} from "lucide-react";

import {
  api,
  ApiError,
  BOT_USERNAME,
  callImageUrl,
  type User,
  type SessionHistoryItem,
  type Leaderboard,
} from "./api";
import { useVoiceCall } from "./voice";
import { InCallTopic, QuestionsBrowser } from "./questions";
import { useTheme, type ThemeMode } from "./theme";
import { useToast } from "./toast";

// ---------------------------------------------------------------------------
// Telegram WebApp shim
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        colorScheme?: "light" | "dark";
        ready: () => void;
        expand: () => void;
        close: () => void;
        openTelegramLink?: (url: string) => void;
        onEvent?: (event: string, cb: () => void) => void;
        offEvent?: (event: string, cb: () => void) => void;
        setBackgroundColor?: (color: string) => void;
        setHeaderColor?: (color: string) => void;
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
type SubPage = "progress" | "history" | "feedback" | "questions";
type LeaderTab = "speakers" | "rated" | "streak";

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
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("su-skeleton", className)} />;
}

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
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center px-8 text-center gap-4">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeletons (content-shaped loading placeholders)
// ---------------------------------------------------------------------------
function AppSkeleton() {
  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* top bar */}
        <div className="flex items-center justify-between px-4 pt-3 pb-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-20 rounded-full" />
            <Skeleton className="h-7 w-12 rounded-full" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        {/* center mic */}
        <div className="flex-1 flex flex-col items-center justify-center gap-8">
          <Skeleton className="w-36 h-36 rounded-full" />
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        {/* recent */}
        <div className="px-4 pb-2 space-y-2">
          <Skeleton className="h-4 w-32 mb-2" />
          {[0, 1].map((i) => (
            <div key={i} className="bg-card border border-border rounded-2xl p-3 flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-16" />
              </div>
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </div>
      {/* nav */}
      <div className="flex-shrink-0 border-t border-border bg-card flex">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5 py-3">
            <Skeleton className="w-5 h-5 rounded-md" />
            <Skeleton className="h-2 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function LeaderboardSkeleton() {
  // Mirrors LeaderboardScreen's real layout so nothing jumps on load: a podium
  // (2nd / 1st-with-crown / 3rd, avatar+name+bar) above a scrollable row list.
  return (
    <>
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-end justify-center gap-3">
          {/* 2nd — Avatar md + bar h-16 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <Skeleton className="w-10 h-10 rounded-full" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="w-full h-16 rounded-t-xl" />
          </div>
          {/* 1st — Crown + Avatar lg + bar h-24 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <Skeleton className="w-5 h-5 rounded-md" />
            <Skeleton className="w-14 h-14 rounded-full" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="w-full h-24 rounded-t-xl" />
          </div>
          {/* 3rd — Avatar md + bar h-12 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <Skeleton className="w-10 h-10 rounded-full" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="w-full h-12 rounded-t-xl" />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-card border border-border rounded-2xl p-3 flex items-center gap-3">
            <Skeleton className="w-7 h-4" />
            <Skeleton className="w-8 h-8 rounded-full" />
            <Skeleton className="h-3 flex-1 max-w-[120px]" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Speaking (main)
// ---------------------------------------------------------------------------
function SpeakingScreen({
  user,
  history,
  onFindPartner,
  onOpenQuestions,
}: {
  user: User;
  history: SessionHistoryItem[];
  onFindPartner: () => void;
  onOpenQuestions: () => void;
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
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-xs font-semibold text-foreground">{user.streak}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => { haptic("light"); onOpenQuestions(); }}
            className="flex items-center gap-1.5 bg-secondary rounded-full px-3 py-1.5 text-xs font-semibold text-foreground"
          >
            <BookOpen className="w-3.5 h-3.5 text-orange-400" /> Savollar
          </button>
          <div className="bg-orange-500/15 border border-orange-500/30 rounded-full px-3 py-1">
            <span className="text-xs font-bold text-orange-400 tracking-wide">{levelLabel(user.level)}</span>
          </div>
        </div>
      </div>

      {/* Center mic area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
        <div className="relative flex items-center justify-center">
          <div className={cn("absolute w-64 h-64 rounded-full border transition-all duration-500", micActive ? "border-orange-500/30 scale-110" : "border-foreground/5")} />
          <div className={cn("absolute w-48 h-48 rounded-full border transition-all duration-500", micActive ? "border-orange-500/20 scale-105" : "border-foreground/10")} />

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
          <p className="text-foreground font-semibold text-base">Tap to find a partner</p>
          <p className="text-muted-foreground text-xs">We'll connect you with someone to practice with</p>
        </div>
      </div>

      {/* Recent sessions */}
      <div className="px-4 pb-2">
        <h3 className="text-sm font-semibold text-foreground mb-2">Recent Sessions</h3>
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
                    <p className="text-sm font-semibold text-foreground truncate">{partner}</p>
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
// Real-time voice call overlay (matchmaking + WebRTC)
// ---------------------------------------------------------------------------
function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline className="hidden" />;
}

function VoiceOverlay({ onClose }: { onClose: () => void }) {
  const { haptic, hapticNotify } = useTelegram();
  const toast = useToast();
  const v = useVoiceCall();
  const started = useRef(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [stars, setStars] = useState(0); // selected rating, 0 = none yet
  const [lightbox, setLightbox] = useState<string | null>(null); // enlarged image id
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) v.sendImage(f);
    e.target.value = ""; // allow re-picking the same file
  };

  const submitRating = async () => {
    if (rateBusy) return;
    if (!stars || !v.partner) { onClose(); return; }
    setRateBusy(true);
    haptic("medium");
    try { await api.ratePartner(v.partner.id, stars); toast.success("Rahmat!"); }
    catch { /* non-blocking */ }
    onClose();
  };

  useEffect(() => {
    if (!started.current) { started.current = true; v.start(); }
  }, [v]);

  useEffect(() => {
    if (v.state === "in_call") {
      hapticNotify("success");
      toast.success("Hamroh topildi — suhbat boshlandi");
    }
  }, [v.state, hapticNotify, toast]);

  useEffect(() => {
    if (v.state === "error") toast.error(v.error || "Ovozli aloqa xatosi");
  }, [v.state, v.error, toast]);

  const close = () => { haptic("heavy"); v.hangup(); onClose(); };
  // End an active call but STAY mounted so the ender lands on the rating screen
  // too (both peers must rate each other). onClose runs after rate/skip.
  const endCall = () => { haptic("heavy"); v.hangup(); };

  // Searching / connecting
  if (v.state === "searching" || v.state === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-8">
        <div className="relative flex items-center justify-center">
          <div className="absolute w-56 h-56 rounded-full border border-orange-500/10 animate-ping" style={{ animationDuration: "2s" }} />
          <div className="absolute w-44 h-44 rounded-full border border-orange-500/15 animate-ping" style={{ animationDuration: "2.5s", animationDelay: "0.5s" }} />
          <div className="w-28 h-28 rounded-full flex items-center justify-center"
            style={{ background: "radial-gradient(circle at 35% 35%, #fb923c, #f97316, #ea580c)", boxShadow: "0 0 50px rgba(249,115,22,0.4)" }}>
            <Search className="w-14 h-14 text-white" strokeWidth={1.5} />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-foreground">
            {v.state === "connecting" ? "Ulanmoqda…" : "Hamroh qidirilmoqda…"}
          </h2>
          <p className="text-muted-foreground text-sm max-w-xs">
            {v.state === "connecting" ? "Ovozli aloqa o'rnatilmoqda" : "Sizning darajangizdagi suhbatdosh qidirilmoqda"}
          </p>
        </div>
        <button onClick={() => { haptic("light"); setConfirmCancel(true); }} className="flex items-center gap-2 bg-secondary border border-border rounded-2xl px-6 py-3 text-sm font-semibold text-foreground">
          <X className="w-4 h-4" /> Bekor qilish
        </button>

        {confirmCancel && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setConfirmCancel(false)}>
            <div className="w-full max-w-sm bg-card border border-border rounded-3xl p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
              <div className="text-center space-y-1.5">
                <h3 className="text-lg font-bold text-foreground">Qidiruvni bekor qilasizmi?</h3>
                <p className="text-sm text-muted-foreground">Hamroh qidirish to'xtatiladi.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { haptic("light"); setConfirmCancel(false); }}
                  className="flex-1 bg-secondary border border-border rounded-2xl py-3 text-sm font-semibold text-foreground">
                  Yo'q
                </button>
                <button onClick={() => { setConfirmCancel(false); close(); }}
                  className="flex-1 bg-red-500 rounded-2xl py-3 text-sm font-bold text-white">
                  Ha, bekor qilish
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (v.state === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-6">
        <div className="w-14 h-14 rounded-2xl bg-red-500/15 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-400" />
        </div>
        <p className="text-sm text-muted-foreground max-w-xs">{v.error || "Xatolik yuz berdi"}</p>
        <button onClick={onClose} className="bg-orange-500 text-white text-sm font-semibold px-6 py-3 rounded-2xl">Yopish</button>
      </div>
    );
  }

  if (v.state === "ended") {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-6">
        <CheckCircle className="w-12 h-12 text-emerald-400" />
        <h2 className="text-xl font-bold text-foreground">Suhbat tugadi</h2>
        {v.partner ? (
          <>
            <p className="text-sm text-muted-foreground">
              {v.partner.name} bilan suhbatni baholang
            </p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => { haptic("light"); setStars(n); }} disabled={rateBusy} className="p-1 transition-transform active:scale-90">
                  <Star
                    className={cn("w-9 h-9 transition-colors", n <= stars ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground")}
                    strokeWidth={1.5}
                  />
                </button>
              ))}
            </div>
            <button
              onClick={submitRating}
              disabled={rateBusy || stars === 0}
              className="bg-orange-500 text-white text-sm font-bold px-8 py-3 rounded-2xl disabled:opacity-40 transition-opacity"
            >
              {rateBusy ? "Yuborilmoqda…" : "Baholash"}
            </button>
            <button onClick={onClose} disabled={rateBusy} className="text-sm text-muted-foreground underline disabled:opacity-40">
              O'tkazib yuborish
            </button>
          </>
        ) : (
          <button onClick={onClose} className="bg-orange-500 text-white text-sm font-semibold px-6 py-3 rounded-2xl">Yopish</button>
        )}
      </div>
    );
  }

  // In call
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-8">
      <RemoteAudio stream={v.remoteStream} />
      {(v.quality === "poor" || v.quality === "bad") && (
        <div className={cn(
          "fixed top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold",
          v.quality === "bad" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"
        )}>
          <AlertTriangle className="w-3.5 h-3.5" />
          {v.quality === "bad" ? "Internet juda sekin — ovoz kechikishi mumkin" : "Internet sekin"}
        </div>
      )}
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <Avatar name={v.partner?.name ?? "?"} size="lg" />
          <span className="absolute inset-0 rounded-full border-2 border-orange-500/40 animate-ping" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground">{v.partner?.name ?? "Hamroh"}</h2>
          <p className="text-sm text-muted-foreground mt-1">Jonli ovozli suhbat</p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span className="text-4xl font-bold text-foreground tabular-nums">{fmtClock(v.elapsed)}</span>
        <span className="text-xs text-muted-foreground">Suhbat vaqti</span>
      </div>

      <InCallTopic onHaptic={() => haptic("light")} />

      {/* Shared-image strip: tap the tile to upload a photo of your questions;
          it shows for both peers. Tap a thumbnail to enlarge. */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
      <div className="w-full max-w-sm flex items-center gap-2 overflow-x-auto py-1">
        <button
          onClick={() => { haptic("light"); fileRef.current?.click(); }}
          disabled={v.uploadingImage}
          className="shrink-0 w-16 h-16 rounded-xl border-2 border-dashed border-border bg-secondary flex flex-col items-center justify-center gap-0.5 text-muted-foreground disabled:opacity-60"
        >
          {v.uploadingImage
            ? <Loader2 className="w-5 h-5 animate-spin text-orange-400" />
            : <><ImagePlus className="w-5 h-5" /><span className="text-[9px]">Rasm</span></>}
        </button>
        {v.images.map((img) => (
          <button
            key={img.id}
            onClick={() => { haptic("light"); setLightbox(img.id); }}
            className={cn(
              "shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2",
              img.mine ? "border-orange-500/50" : "border-blue-500/50"
            )}
          >
            <img src={callImageUrl(img.id)} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={callImageUrl(lightbox)} alt="" className="max-w-full max-h-full rounded-lg object-contain" />
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-4">
        <button onClick={() => { haptic("light"); v.toggleMute(); }}
          className={cn("w-14 h-14 rounded-full flex items-center justify-center border transition-all",
            v.muted ? "bg-foreground/10 border-foreground/20 text-foreground" : "bg-secondary border-border text-muted-foreground")}>
          {v.muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
        <button onClick={endCall}
          className="flex items-center gap-2 bg-red-500 rounded-full px-8 py-4 text-sm font-bold text-white"
          style={{ boxShadow: "0 8px 32px rgba(239,68,68,0.35)" }}>
          <PhoneOff className="w-5 h-5" /> Tugatish
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Leaderboard
// ---------------------------------------------------------------------------
function LeaderboardScreen() {
  const { haptic } = useTelegram();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<LeaderTab>("speakers");
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.leaderboard()
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (!alive) return;
        const msg = e instanceof ApiError ? e.message : "Failed to load";
        setError(msg);
        toast.error(msg);
      });
    return () => { alive = false; };
  }, [toast]);

  const tabs: { id: LeaderTab; label: string }[] = [
    { id: "speakers", label: "Top Speakers" },
    { id: "rated", label: "Top Rated" },
    { id: "streak", label: "Streak" },
  ];

  const rows = data
    ? [...data.week]
        .filter((r) => (activeTab === "rated" ? r.rating_count >= 1 : true)) // any rating qualifies
        .sort((a, b) =>
          activeTab === "streak" ? b.streak - a.streak
          // Top Rated: highest avg first; break ties by who has more ratings,
          // then by minutes — so a 5.0 from 10 raters outranks a 5.0 from 1.
          : activeTab === "rated" ? (b.rating - a.rating) || (b.rating_count - a.rating_count) || (b.minutes - a.minutes)
          : b.minutes - a.minutes
        )
    : [];

  const valueOf = (r: Leaderboard["week"][number]) =>
    activeTab === "streak" ? `${r.streak} days`
    : activeTab === "rated" ? `★ ${r.rating.toFixed(1)}`
    : `${r.minutes.toLocaleString()} min`;

  const meInTop = rows.some((r) => r.is_me);
  const medalColors = ["#f59e0b", "#94a3b8", "#b45309"];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-6 h-6 text-orange-400" />
          <h1 className="text-xl font-bold text-foreground">Leaderboard</h1>
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

      {/* Loading skeleton */}
      {!data && !error && <LeaderboardSkeleton />}

      {error && <p className="px-4 text-sm text-red-400">{error}</p>}

      {data && rows.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-8 text-center">
          <p className="text-sm text-muted-foreground">No one has practiced this week yet. Be the first!</p>
        </div>
      )}

      {rows.length >= 3 && (
        <div className="px-4 pb-4 pt-2">
          <div className="flex items-end justify-center gap-3">
            {/* 2nd */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <Avatar name={rows[1].name} size="md" />
              <p className="text-xs font-semibold text-foreground truncate w-full text-center">{rows[1].name.split(" ")[0]}</p>
              <div className="w-full rounded-t-xl flex items-center justify-center h-16" style={{ background: "linear-gradient(180deg, #475569 0%, #334155 100%)" }}>
                <Medal className="w-5 h-5" style={{ color: medalColors[1] }} />
              </div>
            </div>
            {/* 1st */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <Crown className="w-5 h-5 text-amber-400" />
              <Avatar name={rows[0].name} size="lg" />
              <p className="text-xs font-semibold text-foreground truncate w-full text-center">{rows[0].name.split(" ")[0]}</p>
              <div className="w-full rounded-t-xl flex items-center justify-center h-24" style={{ background: "linear-gradient(180deg, #f97316 0%, #ea580c 100%)" }}>
                <Medal className="w-6 h-6" style={{ color: medalColors[0] }} />
              </div>
            </div>
            {/* 3rd */}
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <Avatar name={rows[2].name} size="md" />
              <p className="text-xs font-semibold text-foreground truncate w-full text-center">{rows[2].name.split(" ")[0]}</p>
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
                <p className="text-sm font-semibold text-foreground truncate">{r.is_me ? "Siz" : r.name}</p>
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
                  <p className="text-sm font-semibold text-foreground">You</p>
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
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${user.telegram_id}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(refLink).catch(() => {});
    setCopied(true);
    hapticNotify("success");
    toast.success("Havola nusxalandi");
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
      <div className="bg-gradient-to-br from-orange-500/20 via-orange-500/10 to-transparent border border-orange-500/20 rounded-3xl p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-orange-500 flex items-center justify-center flex-shrink-0">
            <Gift className="w-7 h-7 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground">Invite your friends</h2>
            <p className="text-muted-foreground text-sm">Practice English together on SpeakUp</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">Your invite link</p>
        <div className="bg-card border border-border rounded-2xl p-3 flex items-center gap-3">
          <p className="flex-1 text-xs text-muted-foreground truncate font-mono">{refLink}</p>
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl transition-all",
              copied ? "bg-green-500/20 text-green-500" : "bg-orange-500 text-white"
            )}
          >
            {copied ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <button
          onClick={handleShare}
          className="w-full flex items-center justify-center gap-2 bg-secondary border border-border rounded-2xl py-3.5 text-sm font-semibold text-foreground"
        >
          <Share2 className="w-4 h-4 text-orange-400" />
          Share via Telegram
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appearance (theme) control
// ---------------------------------------------------------------------------
function ThemeControl() {
  const { mode, setMode } = useTheme();
  const { haptic } = useTelegram();
  const opts: { id: ThemeMode; label: string; icon: ReactNode }[] = [
    { id: "auto", label: "Auto", icon: <Smartphone className="w-4 h-4" /> },
    { id: "light", label: "Light", icon: <Sun className="w-4 h-4" /> },
    { id: "dark", label: "Dark", icon: <Moon className="w-4 h-4" /> },
  ];
  return (
    <div className="bg-secondary rounded-2xl p-1 flex">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => { setMode(o.id); haptic("light"); }}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl transition-all duration-200",
            mode === o.id ? "bg-orange-500 text-white shadow-sm" : "text-muted-foreground"
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Profile
// ---------------------------------------------------------------------------
function ProfileScreen({ user, onOpen }: { user: User; onOpen: (page: SubPage) => void }) {
  const { haptic } = useTelegram();
  const displayName = user.first_name ?? user.username ?? "You";
  const username = user.username ? `@${user.username}` : `id ${user.telegram_id}`;

  const menu: { icon: ReactNode; label: string; page: SubPage }[] = [
    { icon: <Star className="w-4 h-4" />, label: "My Progress", page: "progress" },
    { icon: <Clock className="w-4 h-4" />, label: "Call History", page: "history" },
    { icon: <Volume2 className="w-4 h-4" />, label: "Leave feedback", page: "feedback" },
  ];

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
          <h2 className="text-lg font-bold text-foreground">{displayName}</h2>
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
            <p className="text-xl font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="px-4 space-y-2 flex-1 overflow-y-auto pb-4">
        <div className="space-y-2 mb-3">
          {menu.map((item) => (
            <button
              key={item.label}
              onClick={() => { haptic("light"); onOpen(item.page); }}
              className="w-full bg-card border border-border rounded-2xl p-3.5 flex items-center gap-3 text-left"
            >
              <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-orange-400 flex-shrink-0">
                {item.icon}
              </div>
              <p className="flex-1 text-sm font-semibold text-foreground">{item.label}</p>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          ))}
        </div>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-3">My profile</p>
        {profileRows.map((item) => (
          <div key={item.label} className="w-full bg-card border border-border rounded-2xl p-3.5 flex items-center gap-3 text-left">
            <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-orange-400 flex-shrink-0">
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.sub}</p>
            </div>
          </div>
        ))}

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-3 pt-3">Appearance</p>
        <ThemeControl />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-page header (back row)
// ---------------------------------------------------------------------------
function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { haptic } = useTelegram();
  return (
    <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border">
      <button onClick={() => { haptic("light"); onBack(); }} className="text-orange-400">
        <ChevronLeft className="w-6 h-6" />
      </button>
      <h1 className="text-lg font-bold text-foreground">{title}</h1>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: My Progress
// ---------------------------------------------------------------------------
function ProgressScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<import("./api").Progress | null>(null);

  useEffect(() => {
    api.getProgress().then(setData).catch(() => {});
  }, []);

  const max = data ? Math.max(1, ...data.by_day.map((d) => d.minutes)) : 1;
  const stats = data
    ? [
        { label: "Total minutes", value: `${data.total_minutes}` },
        { label: "Sessions", value: `${data.total_sessions}` },
        { label: "Streak", value: `${data.streak} days` },
        { label: "Best day", value: `${data.best_day} min` },
      ]
    : [];

  return (
    <div className="flex flex-col h-full">
      <SubHeader title="My Progress" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              <p className="text-xl font-bold text-foreground">{s.value}</p>
            </div>
          ))}
        </div>
        {data && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-sm font-semibold text-foreground mb-3">Last 30 days</p>
            <div className="flex items-end gap-0.5 h-32">
              {data.by_day.map((d) => (
                <div
                  key={d.date}
                  className="flex-1 bg-orange-500/70 rounded-t"
                  style={{ height: `${Math.max((d.minutes / max) * 100, 2)}%` }}
                  title={`${d.date}: ${d.minutes} min`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Call History
// ---------------------------------------------------------------------------
function CallHistoryScreen({ history, onBack }: { history: SessionHistoryItem[]; onBack: () => void }) {
  const done = history.filter((s) => s.end_time);
  return (
    <div className="flex flex-col h-full">
      <SubHeader title="Call History" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {done.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center pt-8">No calls yet.</p>
        ) : (
          done.map((s) => {
            const partner = s.partner_name ?? "Partner";
            return (
              <div key={s.id} className="bg-card rounded-2xl p-3 flex items-center gap-3 border border-border">
                <Avatar name={partner} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{partner}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.topic ?? "Practice"}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-semibold text-orange-400">{minutesFromSec(s.duration_sec)} min</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(s.start_time)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SCREEN: Leave feedback
// ---------------------------------------------------------------------------
function FeedbackScreen({ onBack }: { onBack: () => void }) {
  const { hapticNotify } = useTelegram();
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.postFeedback(rating, text.trim());
      hapticNotify("success");
      toast.success("Rahmat! Fikringiz yuborildi.");
      onBack();
    } catch {
      toast.error("Yuborib bo'lmadi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <SubHeader title="Leave feedback" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        <div>
          <p className="text-sm font-semibold text-foreground mb-2">Your rating</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} className="p-1">
                <Star
                  className={cn("w-8 h-8", n <= rating ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground")}
                  strokeWidth={1.5}
                />
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground mb-2">Your feedback</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={1024}
            placeholder="Tell us what you think…"
            className="w-full bg-card border border-border rounded-2xl p-3 text-sm text-foreground resize-none outline-none focus:border-orange-500/50"
          />
        </div>
        <button
          onClick={submit}
          disabled={busy}
          className="w-full bg-orange-500 text-white font-semibold py-3.5 rounded-2xl disabled:opacity-60"
        >
          {busy ? "Sending…" : "Send feedback"}
        </button>
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
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);

  const [activeNav, setActiveNav] = useState<NavTab>("speaking");
  const [finding, setFinding] = useState(false);
  const findingRef = useRef(false);
  const [sub, setSub] = useState<SubPage | null>(null);

  // Layout setup (theme/background handled by ThemeProvider).
  useEffect(() => {
    document.documentElement.style.fontFamily = "'Inter', system-ui, sans-serif";
    document.body.style.overflow = "hidden";
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

  // Opened from the bot's "Join now" button (?find=1) → jump straight into search.
  const autoFind = useRef(false);
  useEffect(() => {
    if (phase !== "ready" || autoFind.current) return;
    const wantsFind = new URLSearchParams(window.location.search).get("find") === "1";
    if (wantsFind && !findingRef.current) {
      autoFind.current = true;
      findingRef.current = true;
      setActiveNav("speaking");
      setFinding(true);
    }
  }, [phase]);

  // Telegram BackButton during finding / call / sub-page.
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    if (finding) {
      tg.BackButton.show();
      // Reset the ref too, else re-tapping "start talking" is blocked. The
      // overlay unmounts → its cleanup closes the socket → server dequeues us.
      const cb = () => { findingRef.current = false; setFinding(false); loadAll().catch(() => {}); };
      tg.BackButton.onClick(cb);
      return () => { tg.BackButton.offClick(cb); tg.BackButton.hide(); };
    }
    if (sub) {
      tg.BackButton.show();
      const cb = () => { setSub(null); loadAll().catch(() => {}); };
      tg.BackButton.onClick(cb);
      return () => { tg.BackButton.offClick(cb); tg.BackButton.hide(); };
    }
    tg.BackButton.hide();
  }, [finding, sub]);

  const handleRetry = () => {
    setPhase("loading");
    loadAll()
      .then(() => setPhase("ready"))
      .catch((e) => {
        const msg = e instanceof ApiError ? e.message : "Could not reach the server";
        setErrorMsg(msg);
        toast.error(msg);
        setPhase("error");
      });
  };

  // ---- Render gates ----
  if (phase === "loading") {
    return <AppSkeleton />;
  }

  if (phase === "error" || !user) {
    return (
      <Centered>
        <div className="w-14 h-14 rounded-2xl bg-red-500/15 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-red-400" />
        </div>
        <h1 className="text-lg font-bold text-foreground">Can't load your profile</h1>
        <p className="text-sm text-muted-foreground max-w-xs">{errorMsg}</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Open this app from the SpeakUp Telegram bot (the “Find Partner” button) so it can verify your account.
        </p>
        <button
          onClick={handleRetry}
          className="bg-orange-500 text-white text-sm font-semibold px-6 py-3 rounded-2xl flex items-center gap-2"
        >
          <Loader2 className="w-4 h-4" />
          Try again
        </button>
      </Centered>
    );
  }

  // ---- Voice call overlay (matchmaking + WebRTC) ----
  if (finding) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col">
        <VoiceOverlay onClose={() => { findingRef.current = false; setFinding(false); loadAll().catch(() => {}); }} />
      </div>
    );
  }

  const closeSub = () => { setSub(null); loadAll().catch(() => {}); };

  const renderMain = () => {
    if (sub === "progress") return <ProgressScreen onBack={closeSub} />;
    if (sub === "history") return <CallHistoryScreen history={history} onBack={closeSub} />;
    if (sub === "feedback") return <FeedbackScreen onBack={closeSub} />;
    if (sub === "questions") return <QuestionsBrowser onBack={() => setSub(null)} />;
    switch (activeNav) {
      case "speaking":
        return <SpeakingScreen user={user} history={history} onOpenQuestions={() => setSub("questions")} onFindPartner={() => { if (!findingRef.current) { findingRef.current = true; setFinding(true); } }} />;
      case "leaderboard":
        return <LeaderboardScreen />;
      case "invite":
        return <InviteScreen user={user} />;
      case "profile":
        return <ProfileScreen user={user} onOpen={setSub} />;
    }
  };

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ WebkitOverflowScrolling: "touch" }}>
        {renderMain()}
      </div>
      <BottomNav active={activeNav} onChange={(t) => { setSub(null); setActiveNav(t); }} />
    </div>
  );
}
