"use client";

import { useLanes, useSSE } from "@harness/sdk/react";
import { useCallback } from "react";
import { StatusCounter } from "@/components/StatusCounter";
import { SchedulerControl } from "@/components/SchedulerControl";
import { LaneCard } from "@/components/LaneCard";
import { PipelineSVG } from "@/components/PipelineSVG";
import type { SSEEvent } from "@harness/types";

export default function DashboardPage() {
  const { lanes, loading, refetch } = useLanes();

  useSSE(
    useCallback(
      (event: SSEEvent) => {
        if (event.type.startsWith("lane:") || event.type.startsWith("stage:")) {
          refetch();
        }
      },
      [refetch],
    ),
  );

  const firstLane = lanes[0];

  return (
    <div className="max-w-[1320px] mx-auto">
      <div className="flex items-baseline gap-3.5 flex-wrap mb-4">
        <h1 className="text-2xl font-extrabold tracking-tight">Feature Harness</h1>
        <span className="text-sm text-[var(--muted)]">parallel lanes — live watch</span>
        <span className="flex-1" />
        <StatusCounter lanes={lanes} />
      </div>

      <SchedulerControl />

      {firstLane && (
        <div className="bg-gradient-to-b from-[#0c121d] to-[#0a0f18] border border-[var(--line)] rounded-2xl p-4 mb-5">
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="font-bold text-sm">Lane {firstLane.id}</span>
            <span className="font-mono text-[11.5px] text-blue-300 border border-blue-800 bg-blue-950 rounded px-2 py-0.5">
              {firstLane.mode}
            </span>
            <span className="text-sm text-gray-300">{firstLane.title}</span>
          </div>
          <PipelineSVG currentStage={firstLane.stageIndex} />
        </div>
      )}

      {loading && lanes.length === 0 && (
        <div className="text-center py-16 text-[var(--muted)]">Loading lanes...</div>
      )}

      {!loading && lanes.length === 0 && (
        <div className="text-center py-16 text-[var(--muted)]">
          <h2 className="text-white mb-2">No lanes yet</h2>
          <p>Add your first lane to get started</p>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {lanes.map((lane) => (
          <LaneCard key={lane.id} lane={lane} />
        ))}
      </div>
    </div>
  );
}
