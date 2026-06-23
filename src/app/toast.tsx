import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle, AlertTriangle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

const ICONS: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info,
};

// Accent ring/icon colour per type. Surface stays themed (card) so toasts read
// well in both light and dark mode.
const ACCENT: Record<ToastType, string> = {
  success: "text-emerald-500",
  error: "text-red-500",
  info: "text-orange-500",
};

const HAPTIC: Record<ToastType, "success" | "error" | "warning"> = {
  success: "success",
  error: "error",
  info: "warning",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string) => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-2), { id, type, message }]);
      try {
        (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(
          HAPTIC[type]
        );
      } catch {
        /* no telegram haptics outside the app */
      }
      window.setTimeout(() => dismiss(id), 3200);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed top-0 left-0 right-0 z-[100] flex flex-col items-center gap-2 px-3 pt-3 pointer-events-none">
        {items.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div
              key={t.id}
              onClick={() => dismiss(t.id)}
              className="su-toast-in pointer-events-auto w-full max-w-sm flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3 shadow-lg"
              style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${ACCENT[t.type]}`} />
              <p className="flex-1 text-sm font-medium text-foreground leading-snug">
                {t.message}
              </p>
              <X className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
