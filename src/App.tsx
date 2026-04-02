import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface Clip {
  id: string;
  text: string;
  pinned: boolean;
  createdAt: number;
}

const MAX_CLIPS = 50;

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

function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [query, setQuery] = useState("");
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  // Tick forces re-render so relative timestamps stay fresh
  const [, setTick] = useState(0);

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
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  function copyClip(clip: Clip) {
    navigator.clipboard.writeText(clip.text);
    setFlashing((prev) => new Set(prev).add(clip.id));
    setTimeout(() => {
      setFlashing((prev) => {
        const next = new Set(prev);
        next.delete(clip.id);
        return next;
      });
    }, 600);
  }

  function togglePin(id: string) {
    setClips((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
  }

  const filtered = query.trim()
    ? clips.filter((c) =>
        c.text.toLowerCase().includes(query.toLowerCase())
      )
    : clips;

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-white select-none">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-3">
          Clippi
        </h1>
        <input
          type="text"
          placeholder="Search clips..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-zinc-800 text-white placeholder-zinc-500 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-600 transition-shadow"
        />
      </div>

      {/* Clip list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-zinc-600 text-xs text-center mt-8">No clips yet</p>
        ) : (
          filtered.map((clip) => (
            <div
              key={clip.id}
              onClick={() => copyClip(clip)}
              className={[
                "group flex items-start gap-2 rounded-lg px-3 py-2 cursor-pointer",
                "bg-zinc-800 hover:bg-zinc-700 border transition-colors duration-150",
                flashing.has(clip.id) ? "border-white" : "border-transparent",
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
    </div>
  );
}

export default App;
