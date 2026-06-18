// ---------------------------------------------------------------------------
// Backend API client.
// Auth: every request carries the raw Telegram WebApp initData string in the
// `Authorization: tma <initData>` header. The backend validates its HMAC.
// Base URL: VITE_API_URL (e.g. https://api.example.com) or "" to use the same
// origin (dev uses the Vite proxy in vite.config.ts -> http://localhost:8000).
// ---------------------------------------------------------------------------

const BASE: string = (import.meta as any).env?.VITE_API_URL ?? "";

export const BOT_USERNAME: string =
  (import.meta as any).env?.VITE_BOT_USERNAME ?? "yourbot";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function initData(): string {
  return window.Telegram?.WebApp?.initData ?? "";
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `tma ${initData()}`,
      ...(opts.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch {
      /* non-json error body */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Types (mirror backend Pydantic schemas) -----------------------------

export type Level = "beginner" | "intermediate" | "advanced";
export type Challenge = "grammar" | "fluency" | "vocabulary" | "pronunciation";
export type Gender = "male" | "female" | "other";

export interface User {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  level: Level | null;
  goal: string | null;
  challenge: Challenge | null;
  frequency: string | null;
  location: string | null;
  gender: Gender | null;
  onboarded: boolean;
  total_minutes: number;
  streak: number;
  total_sessions: number;
}

export interface Partner {
  is_ai: boolean;
  partner_id: number | null;
  display_name: string;
  accent: string;
  topic: string;
}

export interface SessionStart {
  session_id: number;
  partner: Partner;
}

export interface SessionEnd {
  session_id: number;
  duration_sec: number;
  minutes: number;
  total_minutes: number;
  streak: number;
}

export interface SessionHistoryItem {
  id: number;
  is_ai: boolean;
  partner_id: number | null;
  partner_name: string | null;
  topic: string | null;
  start_time: string;
  end_time: string | null;
  duration_sec: number;
}

export interface LeaderboardRow {
  rank: number;
  telegram_id: number;
  minutes: number;
  name: string;
  username: string | null;
  streak: number;
  is_me: boolean;
}

export interface Leaderboard {
  week: LeaderboardRow[];
  me: { rank: number; minutes: number } | null;
}

// ---- Endpoints ------------------------------------------------------------

export const api = {
  getMe: () => req<User>("/api/users/me"),

  updateProfile: (patch: Partial<Pick<User, "level" | "goal" | "challenge" | "frequency" | "location" | "gender">>) =>
    req<User>("/api/users/me", { method: "PATCH", body: JSON.stringify(patch) }),

  startSession: () =>
    req<SessionStart>("/api/sessions/start", {
      method: "POST",
      body: JSON.stringify({ is_ai: true }),
    }),

  endSession: (sessionId: number) =>
    req<SessionEnd>("/api/sessions/end", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
    }),

  history: () => req<SessionHistoryItem[]>("/api/sessions/history"),

  leaderboard: () => req<Leaderboard>("/api/leaderboard"),
};
