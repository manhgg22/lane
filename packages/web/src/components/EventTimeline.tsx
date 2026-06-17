import type { LaneEvent } from "@harness/types";

const typeColors: Record<string, string> = {
  stage_enter: "text-blue-400",
  stage_pass: "text-green-400",
  stage_fail: "text-red-400",
  re_enter: "text-purple-400",
  blocked: "text-amber-400",
  action: "text-gray-400",
};

export function EventTimeline({ events }: { events: LaneEvent[] }) {
  const sorted = [...events].sort((a, b) => b.id - a.id);

  return (
    <div className="space-y-1 max-h-80 overflow-y-auto">
      {sorted.map((e) => (
        <div key={e.id} className="font-mono text-[11px] flex gap-2 items-start py-1 border-b border-[#141c28]">
          <span className="text-gray-500 shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
          <span className={`font-bold ${typeColors[e.type] ?? "text-gray-400"}`}>{e.type}</span>
          <span className="text-gray-400 truncate">{JSON.stringify(e.payload)}</span>
        </div>
      ))}
      {sorted.length === 0 && <div className="text-gray-500 text-sm">No events yet</div>}
    </div>
  );
}
