import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface Clip {
  id: string;
  text: string;
  pinned: boolean;
  createdAt: number;
}

interface Slot {
  clip: string | null;
}

const MAX_CLIPS = 50;
// Labels for slots 0–9: key "1"→slot 0 … key "9"→slot 8, key "0"→slot 9
const SLOT_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function Toast({ message }: { message: string | null }) {
  return (
    <div
      className={[
        "absolute bottom-10 left-1/2 -translate-x-1/2 z-50",
        "px-3 py-1.5 rounded-lg bg-zinc-700 text-white text-xs whitespace-nowrap shadow-lg",
        "transition-opacity duration-200",
        message ? "opacity-100" : "opacity-0 pointer-events-none",
      ].join(" ")}
    >
      {message ?? ""}
    </div>
  );
}

function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [query, setQuery] = useState("");
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [slots, setSlots] = useState<Slot[]>(
    Array.from({ length: 10 }, () => ({ clip: null }))
  );
  const [activeSlot, setActiveSlot] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [toast, setToast] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs so the single keydown listener always sees current values
  // without needing to be re-registered on every render.
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const activeSlotRef = useRef(activeSlot);
  activeSlotRef.current = activeSlot;
  const focusedIndexRef = useRef(focusedIndex);
  focusedIndexRef.current = focusedIndex;
  const filteredRef = useRef<Clip[]>([]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("clip-captured", (event) => {
      const clip: Clip = {
        id: crypto.randomUUID(),
        text: event.payload,
        pinned: false,
        createdAt: Date.now(),
      };
      setClips((prev) => [clip, ...prev].slice(0, MAX_CLIPS));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }

  // Writes text to clipboard and sets the suppression flag so the
  // polling thread doesn't re-capture it as a new clip.
  function writeToClipboard(text: string) {
    invoke("set_internal_write");
    navigator.clipboard.writeText(text);
  }

  function copyClip(clip: Clip) {
    // Capture the slot index synchronously before any async work.
    const slotIdx = activeSlotRef.current;
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = { clip: clip.text };
      return next;
    });
    showToast(`Saved to slot ${SLOT_LABELS[slotIdx]}`);
    setFlashing((prev) => new Set(prev).add(clip.id));
    setTimeout(() => {
      setFlashing((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }, 600);
    invoke("set_internal_write").catch(() => {});
    navigator.clipboard.writeText(clip.text).catch(() => {});
  }

  function togglePin(id: string) {
    setClips((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c));
      return [...next.filter((c) => c.pinned), ...next.filter((c) => !c.pinned)];
    });
  }

  // Keyboard handler — registered once, reads fresh values via refs.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isSearch = document.activeElement === searchRef.current;

      // Map key to slot index: "1"→0 … "9"→8, "0"→9
      const slotIndex =
        e.key === "0" ? 9 : e.key >= "1" && e.key <= "9" ? Number(e.key) - 1 : -1;

      // ── Cmd/Ctrl + 1-0: copy from that slot ─────────────────────────────
      if ((e.metaKey || e.ctrlKey) && slotIndex !== -1) {
        e.preventDefault();
        const text = slotsRef.current[slotIndex].clip;
        const label = SLOT_LABELS[slotIndex];
        if (text) {
          writeToClipboard(text);
          showToast(`Copied from slot ${label}`);
        } else {
          showToast(`Slot ${label} is empty`);
        }
        return;
      }

      // Everything below is suppressed while the search input has focus.
      if (isSearch) return;

      // ── 1-0: switch active slot ─────────────────────────────────────────
      if (slotIndex !== -1) {
        activeSlotRef.current = slotIndex;
        setActiveSlot(slotIndex);
        setFocusedIndex(-1);
        return;
      }

      // ── Arrow Up / Down: navigate clip list ──────────────────────────────
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) =>
          Math.min(prev + 1, filteredRef.current.length - 1)
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      // ── Enter: copy focused clip ─────────────────────────────────────────
      if (e.key === "Enter") {
        const idx = focusedIndexRef.current;
        const clip = filteredRef.current[idx];
        if (clip) {
          e.preventDefault();
          copyClip(clip);
        }
        return;
      }

      // ── Delete: clear active slot ────────────────────────────────────────
      if (e.key === "Delete") {
        e.preventDefault();
        const label = SLOT_LABELS[activeSlotRef.current];
        setSlots((prev) =>
          prev.map((s, i) => (i === activeSlotRef.current ? { clip: null } : s))
        );
        showToast(`Slot ${label} cleared`);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset keyboard focus when the search query changes.
  useEffect(() => {
    setFocusedIndex(-1);
  }, [query]);

  const sorted = [
    ...clips.filter((c) => c.pinned),
    ...clips.filter((c) => !c.pinned),
  ];
  const filtered = query.trim()
    ? sorted.filter((c) => c.text.toLowerCase().includes(query.toLowerCase()))
    : sorted;

  // Keep the ref in sync so the keydown handler always has the current list.
  filteredRef.current = filtered;

  const activeSlotClip = slots[activeSlot].clip;

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-white select-none relative">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-zinc-800 shrink-0">
        {/* Drag region */}
        <div
          data-tauri-drag-region
          className="w-full flex items-center px-4 pt-3 pb-2 cursor-move"
        >
          <h1 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest pointer-events-none">
            Clippi
          </h1>
        </div>

        {/* Slot bar */}
        <div className="grid grid-cols-10 gap-1 px-4 pb-2">
          {slots.map((slot, i) => (
            <button
              key={i}
              onClick={() => {
                activeSlotRef.current = i;
                setActiveSlot(i);
                setFocusedIndex(-1);
              }}
              className={[
                "flex flex-col items-center justify-center py-1 rounded text-xs font-mono transition-colors",
                i === activeSlot
                  ? "bg-zinc-700 ring-1 ring-white text-white"
                  : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300",
              ].join(" ")}
              aria-label={`Slot ${SLOT_LABELS[i]}`}
            >
              <span>{SLOT_LABELS[i]}</span>
              <span
                className={[
                  "w-1 h-1 rounded-full mt-0.5",
                  slots[i].clip !== null ? "bg-blue-400" : "bg-zinc-600",
                ].join(" ")}
              />
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search clips..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-zinc-800 text-white placeholder-zinc-500 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-600 transition-shadow"
          />
        </div>
      </div>

      {/* ── Clip list ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-zinc-600 text-xs text-center mt-8">No clips yet</p>
        ) : (
          filtered.map((clip, idx) => (
            <div
              key={clip.id}
              onClick={() => copyClip(clip)}
              className={[
                "group flex items-start gap-2 rounded-lg px-3 py-2 cursor-pointer",
                "bg-zinc-800 border transition-colors duration-150",
                flashing.has(clip.id)
                  ? "border-white"
                  : idx === focusedIndex
                  ? "border-zinc-500 bg-zinc-700"
                  : "border-transparent hover:bg-zinc-700",
              ].join(" ")}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100 leading-snug line-clamp-2 break-all">
                  {clip.text}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  {timeAgo(clip.createdAt)}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(clip.id);
                }}
                className={[
                  "mt-0.5 shrink-0 p-0.5 rounded transition-colors",
                  clip.pinned
                    ? "text-yellow-400"
                    : "text-zinc-600 hover:text-zinc-300",
                ].join(" ")}
                aria-label={clip.pinned ? "Unpin" : "Pin"}
              >
                <StarIcon filled={clip.pinned} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-zinc-800 text-xs">
        <span className="font-mono text-zinc-400 shrink-0">
          Slot {SLOT_LABELS[activeSlot]}
        </span>
        <span className="text-zinc-700 shrink-0">·</span>
        <span className="truncate text-zinc-500 flex-1">
          {slots[activeSlot]?.clip ?? (
            <span className="italic text-zinc-600">empty</span>
          )}
        </span>
      </div>

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      <Toast message={toast} />
    </div>
  );
}

export default App;
