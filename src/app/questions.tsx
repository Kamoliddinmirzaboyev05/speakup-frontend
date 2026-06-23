// IELTS speaking questions UI: in-call topic card + full browser.
import { useEffect, useState } from "react";
import {
  MessageCircle, RefreshCw, ChevronLeft, ChevronRight, Loader2, BookOpen,
} from "lucide-react";
import { api, type QuestionTopic, type SpeakingPart, type GroupDetail } from "./api";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

const PARTS = [
  { n: 1, label: "Part 1", dot: "bg-emerald-500", text: "text-emerald-400", ring: "ring-emerald-500/40" },
  { n: 2, label: "Part 2", dot: "bg-blue-500", text: "text-blue-400", ring: "ring-blue-500/40" },
  { n: 3, label: "Part 3", dot: "bg-orange-500", text: "text-orange-400", ring: "ring-orange-500/40" },
];

// Part tabs — shared between the in-call card and the browser.
function PartTabs({ part, onPick }: { part: number; onPick: (n: number) => void }) {
  return (
    <div className="bg-secondary rounded-2xl p-1 flex">
      {PARTS.map((p) => (
        <button
          key={p.n}
          onClick={() => onPick(p.n)}
          className={cx(
            "flex-1 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5",
            part === p.n ? "bg-card text-foreground shadow" : "text-muted-foreground"
          )}
        >
          <span className={cx("w-2 h-2 rounded-full", p.dot)} />
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── In-call conversation topic ────────────────────────────────────────────────
export function InCallTopic({ onHaptic }: { onHaptic?: () => void }) {
  const [part, setPart] = useState(1);
  const [qs, setQs] = useState<QuestionTopic[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.speakingQuestions(part)
      .then((d) => { if (alive) { setQs(d); setIdx(0); } })
      .catch(() => alive && setQs([]))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [part]);

  const q = qs[idx];
  const next = () => { onHaptic?.(); if (qs.length) setIdx((i) => (i + 1) % qs.length); };

  return (
    <div className="w-full max-w-sm space-y-3">
      <div className="bg-card border border-border rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-orange-500/15 flex items-center justify-center shrink-0">
            <MessageCircle className="w-4 h-4 text-orange-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] tracking-widest text-muted-foreground font-semibold">SUHBAT MAVZUSI</p>
              {qs.length > 0 && <span className="text-[10px] text-muted-foreground">{idx + 1}/{qs.length}</span>}
            </div>
            <p className="text-sm text-foreground leading-snug min-h-[2.5rem]">
              {loading ? "Yuklanmoqda…" : (q?.text ?? "Bu part uchun savol yo'q")}
            </p>
          </div>
          <button onClick={next} disabled={!qs.length} className="text-muted-foreground hover:text-foreground disabled:opacity-30 shrink-0">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
      <PartTabs part={part} onPick={(n) => { onHaptic?.(); setPart(n); }} />
    </div>
  );
}

// ── Full questions browser (sub-page) ─────────────────────────────────────────
export function QuestionsBrowser({ onBack }: { onBack: () => void }) {
  const [part, setPart] = useState(1);
  const [parts, setParts] = useState<SpeakingPart[] | null>(null);
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(false);

  useEffect(() => {
    api.speakingParts().then(setParts).catch(() => setParts([]));
  }, []);

  const openGroup = (id: number) => {
    setLoadingGroup(true);
    api.speakingGroup(id).then(setGroup).catch(() => setGroup(null)).finally(() => setLoadingGroup(false));
  };

  const groups = parts?.find((p) => p.part === part)?.groups ?? [];
  const pc = PARTS.find((p) => p.n === part)!;

  // Group detail — all questions at once (free reading, not one-by-one).
  if (group) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border">
          <button onClick={() => setGroup(null)} className="text-orange-400"><ChevronLeft className="w-6 h-6" /></button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-foreground truncate">{group.title}</h1>
            <p className="text-xs text-muted-foreground">{group.questions.length} ta savol</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {group.questions.map((q, i) => (
            <div key={q.id} className="bg-card border border-border rounded-2xl p-4 flex gap-3">
              <span className={cx("w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0", pc.dot)}>{i + 1}</span>
              <p className="text-sm text-foreground leading-snug">{q.text}</p>
            </div>
          ))}
          {group.questions.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Savol yo'q</p>}
        </div>
      </div>
    );
  }

  // Group list
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border">
        <button onClick={onBack} className="text-orange-400"><ChevronLeft className="w-6 h-6" /></button>
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-orange-400" /> IELTS savollari
        </h1>
      </div>
      <div className="px-4 pt-3">
        <PartTabs part={part} onPick={setPart} />
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {!parts && <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin text-orange-400 inline" /></div>}
        {parts && groups.map((g, i) => (
          <button key={g.id} onClick={() => openGroup(g.id)} disabled={loadingGroup}
            className="w-full bg-card border border-border rounded-2xl p-4 flex items-center gap-3 text-left hover:border-orange-500/30 transition-colors">
            <span className={cx("w-8 h-8 rounded-full text-white text-sm font-bold flex items-center justify-center shrink-0", pc.dot)}>{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">{g.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{g.question_count} ta savol</p>
            </div>
            {g.tag && <span className={cx("text-[10px] px-2 py-1 rounded-lg bg-secondary font-medium shrink-0", pc.text)}>{g.tag}</span>}
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
        ))}
        {parts && groups.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Bu part uchun mavzu yo'q</p>}
      </div>
    </div>
  );
}
