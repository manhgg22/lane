import type { Lane } from "@harness/types";

const counters = [
  { key: "running", label: "running", cls: "text-green-300 border-green-800" },
  { key: "needs_you", label: "need you", cls: "text-amber-300 border-amber-800" },
  { key: "stalled", label: "stalled", cls: "text-pink-300 border-pink-800" },
] as const;

export function StatusCounter({ lanes }: { lanes: Lane[] }) {
  const counts = {
    total: lanes.length,
    running: lanes.filter((l) => l.status.includes("running")).length,
    needs_you: lanes.filter((l) => l.status.includes("needs_you")).length,
    stalled: lanes.filter((l) => l.status.includes("stalled")).length,
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs px-3 py-1 rounded-full border border-[var(--line)] text-[var(--muted)]">
        <b className="text-white font-bold">{counts.total}</b> lanes
      </span>
      {counters.map((c) => (
        <span key={c.key} className={`text-xs px-3 py-1 rounded-full border ${c.cls}`}>
          <b className="font-bold">{counts[c.key]}</b> {c.label}
        </span>
      ))}
    </div>
  );
}
