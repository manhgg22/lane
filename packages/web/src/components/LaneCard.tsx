import type { Lane } from "@harness/types";
import { STAGES } from "@harness/types";
import Link from "next/link";

function timeAgo(iso: string): { text: string; cls: string } {
  if (!iso) return { text: "—", cls: "text-green-300" };
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 5) return { text: `${mins}m ago`, cls: "text-amber-300" };
  if (mins < 60) return { text: `${mins}m ago`, cls: "text-green-300" };
  const hrs = Math.floor(mins / 60);
  return { text: `${hrs}h ${mins % 60}m ago`, cls: "text-pink-300" };
}

function StatusTag({ status }: { status: string }) {
  const cls =
    status === "stalled"
      ? "text-pink-200 bg-pink-950 border-pink-800"
      : status === "needs_you"
        ? "text-amber-200 bg-amber-950 border-amber-800"
        : "text-blue-200 bg-blue-950 border-blue-800";
  return (
    <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase ${cls}`}>
      {status}
    </span>
  );
}

export function LaneCard({ lane }: { lane: Lane }) {
  const ago = timeAgo(lane.updatedAt);

  return (
    <Link href={`/lanes/${lane.id}`} className="block">
      <div
        className={`bg-[var(--card)] border rounded-xl p-3.5 cursor-pointer transition-all hover:border-[#2a3a52] hover:-translate-y-px border-[var(--card-edge)]
          ${lane.status.includes("stalled") ? "border-t-2 border-t-pink-500" : ""}
          ${lane.status.includes("needs_you") ? "border-t-2 border-t-amber-500" : ""}`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-[11px] tracking-wider text-[var(--muted)]">LANE {lane.id}</span>
          <span className="ml-auto flex gap-1.5">
            {lane.status.map((s) => (
              <StatusTag key={s} status={s} />
            ))}
          </span>
        </div>
        <div className="text-sm font-bold mb-2.5">{lane.title}</div>
        <div className="flex items-center gap-2 mb-2.5">
          <span className="font-mono text-[11.5px] text-blue-300 border border-blue-800 bg-blue-950 rounded px-2 py-0.5">
            {lane.mode}
          </span>
          <span className="flex-1 h-2 rounded-full bg-[#161f2d] overflow-hidden">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-blue-400 via-teal-400 to-purple-400"
              style={{ width: `${lane.progress}%` }}
            />
          </span>
          <span className="font-mono text-[11px] text-[var(--muted)]">{lane.progress}%</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lane.tags.map((t) => (
            <span key={t} className="font-mono text-[10.5px] text-green-200 border border-green-800 rounded px-2 py-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              {t}
            </span>
          ))}
          <span className={`ml-auto font-mono text-[11px] ${ago.cls}`}>{ago.text}</span>
        </div>
        <div className="mt-2 font-mono text-[11.5px] text-gray-400 bg-[#0a0e17] border border-[#141c28] rounded-lg p-2">
          <span className="text-gray-500">⎇ {lane.slug}</span>
          <span className="block text-gray-300 truncate">{lane.git.commit} {lane.git.subject}</span>
          <span className="text-green-400">CI {lane.git.ci}</span>
          <span className="text-blue-300 ml-2">:{lane.port}</span>
        </div>
        {lane.note && (
          <div className={`mt-2 font-mono text-[11px] bg-[#0c1422] border border-[#18243a] border-l-2 rounded-lg p-2
            ${lane.status.includes("needs_you") ? "border-l-amber-500" : "border-l-green-500"}`}>
            {lane.note}
          </div>
        )}
      </div>
    </Link>
  );
}
