"use client";

import { useState, useEffect, useCallback } from "react";

interface AuditEntry {
  id: number;
  ts: string;
  level: string;
  laneId: number | null;
  stage: string | null;
  message: string;
  data: Record<string, unknown>;
}

const LEVEL_COLORS: Record<string, string> = {
  debug: "text-gray-400",
  info: "text-blue-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (levelFilter) params.set("level", levelFilter);
      const res = await fetch(`/api/audit?${params}`);
      if (res.ok) setEntries(await res.json());
    } finally {
      setLoading(false);
    }
  }, [levelFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <div className="max-w-[1320px] mx-auto">
      <div className="flex items-center gap-4 mb-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Audit Log</h1>
        <div className="flex gap-2 ml-auto">
          {["", "debug", "info", "warn", "error"].map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={`rounded px-3 py-1 text-xs ${
                levelFilter === lvl ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
              }`}
            >
              {lvl || "all"}
            </button>
          ))}
          <button
            onClick={fetchEntries}
            className="rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && entries.length === 0 && (
        <div className="text-center py-16 text-gray-500">Loading...</div>
      )}

      <div className="overflow-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-800/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-400">Time</th>
              <th className="px-3 py-2 text-left font-medium text-gray-400">Level</th>
              <th className="px-3 py-2 text-left font-medium text-gray-400">Lane</th>
              <th className="px-3 py-2 text-left font-medium text-gray-400">Stage</th>
              <th className="px-3 py-2 text-left font-medium text-gray-400">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-gray-800/30">
                <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap font-mono text-xs">
                  {entry.ts}
                </td>
                <td className={`px-3 py-1.5 font-mono text-xs ${LEVEL_COLORS[entry.level] ?? "text-gray-300"}`}>
                  {entry.level}
                </td>
                <td className="px-3 py-1.5 text-gray-300">
                  {entry.laneId ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-gray-300">
                  {entry.stage ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-gray-200">
                  {entry.message}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && entries.length === 0 && (
        <div className="text-center py-16 text-gray-500">No audit entries found</div>
      )}
    </div>
  );
}
