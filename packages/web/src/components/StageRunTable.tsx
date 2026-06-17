import type { StageRun } from "@harness/types";

export function StageRunTable({ stageRuns }: { stageRuns: StageRun[] }) {
  const sorted = [...stageRuns].sort((a, b) => b.id - a.id);

  return (
    <table className="w-full text-[11px] font-mono">
      <thead>
        <tr className="text-gray-500 text-left border-b border-[#1a2433]">
          <th className="py-1 px-2">Stage</th>
          <th className="py-1 px-2">#</th>
          <th className="py-1 px-2">State</th>
          <th className="py-1 px-2">Result</th>
          <th className="py-1 px-2">Message</th>
          <th className="py-1 px-2">Started</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((sr) => (
          <tr key={sr.id} className="border-b border-[#141c28] hover:bg-[#0d131e]">
            <td className="py-1 px-2 text-blue-300">{sr.stage}</td>
            <td className="py-1 px-2">{sr.attempt}</td>
            <td className="py-1 px-2">
              <span
                className={
                  sr.state === "done"
                    ? "text-green-400"
                    : sr.state === "current"
                      ? "text-blue-400"
                      : "text-gray-400"
                }
              >
                {sr.state}
              </span>
            </td>
            <td className="py-1 px-2">
              <span
                className={
                  sr.result === "pass"
                    ? "text-green-400"
                    : sr.result === "fail"
                      ? "text-red-400"
                      : sr.result === "blocked"
                        ? "text-amber-400"
                        : "text-gray-500"
                }
              >
                {sr.result ?? "—"}
              </span>
            </td>
            <td className="py-1 px-2 text-gray-400 truncate max-w-[200px]">{sr.message || "—"}</td>
            <td className="py-1 px-2 text-gray-500">{new Date(sr.startedAt).toLocaleTimeString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
