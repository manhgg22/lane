"use client";

import { useState, useEffect, useCallback } from "react";

interface SchedulerState {
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  totalTicks: number;
}

export function SchedulerControl() {
  const [state, setState] = useState<SchedulerState | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/scheduler/status");
      if (res.ok) setState(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const toggle = async () => {
    setLoading(true);
    try {
      const endpoint = state?.running ? "/api/scheduler/stop" : "/api/scheduler/start";
      await fetch(endpoint, { method: "POST" });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  const tick = async () => {
    setLoading(true);
    try {
      await fetch("/api/scheduler/tick", { method: "POST" });
      await fetchStatus();
    } finally {
      setLoading(false);
    }
  };

  if (!state) return null;

  const ago = state.lastTickAt
    ? `${Math.round((Date.now() - new Date(state.lastTickAt + "Z").getTime()) / 1000)}s ago`
    : "never";

  return (
    <div className="flex items-center gap-3 rounded-lg bg-gray-800/50 px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${state.running ? "bg-green-400 animate-pulse" : "bg-gray-500"}`}
        />
        <span className="text-gray-300">
          Scheduler {state.running ? "running" : "stopped"}
        </span>
      </div>
      <span className="text-gray-500">|</span>
      <span className="text-gray-400">ticks: {state.totalTicks}</span>
      <span className="text-gray-400">last: {ago}</span>
      <div className="ml-auto flex gap-2">
        <button
          onClick={tick}
          disabled={loading}
          className="rounded bg-blue-600 px-3 py-1 text-xs hover:bg-blue-500 disabled:opacity-50"
        >
          Tick
        </button>
        <button
          onClick={toggle}
          disabled={loading}
          className={`rounded px-3 py-1 text-xs ${
            state.running
              ? "bg-red-600 hover:bg-red-500"
              : "bg-green-600 hover:bg-green-500"
          } disabled:opacity-50`}
        >
          {state.running ? "Stop" : "Start"}
        </button>
      </div>
    </div>
  );
}
