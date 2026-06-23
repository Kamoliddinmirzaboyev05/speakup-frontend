import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Theme mode the user picked. "auto" follows the Telegram client (or the OS
// when opened in a browser); "light"/"dark" force a choice. The resolved value
// is the concrete light|dark actually applied.
export type ThemeMode = "auto" | "light" | "dark";
type Resolved = "light" | "dark";

const STORAGE_KEY = "su_theme";

interface ThemeCtx {
  mode: ThemeMode;
  resolved: Resolved;
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "auto" || v === "light" || v === "dark") return v;
  } catch {
    /* private mode / disabled storage */
  }
  return "auto";
}

// What "auto" resolves to: prefer Telegram's colorScheme, fall back to the OS.
function systemScheme(): Resolved {
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.colorScheme === "light" || tg?.colorScheme === "dark") {
    return tg.colorScheme;
  }
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStored);
  const [system, setSystem] = useState<Resolved>(systemScheme);

  const resolved: Resolved = mode === "auto" ? system : mode;

  // Apply the resolved theme to <html> + sync the Telegram chrome colors.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    const bg = resolved === "dark" ? "#111111" : "#f6f7f9";
    document.body.style.background = bg;
    const tg = (window as any).Telegram?.WebApp;
    try {
      tg?.setBackgroundColor?.(bg);
      tg?.setHeaderColor?.(bg);
    } catch {
      /* older Telegram clients lack these setters */
    }
  }, [resolved]);

  // Keep "auto" in sync with the client/OS theme as it changes live.
  useEffect(() => {
    if (mode !== "auto") return;
    const update = () => setSystem(systemScheme());
    const tg = (window as any).Telegram?.WebApp;
    tg?.onEvent?.("themeChanged", update);
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    mq?.addEventListener?.("change", update);
    return () => {
      tg?.offEvent?.("themeChanged", update);
      mq?.removeEventListener?.("change", update);
    };
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ mode, resolved, setMode }),
    [mode, resolved, setMode]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
