"use client";

import { useMutation } from "@harness/sdk/react";
import type { HarnessClient } from "@harness/sdk";

interface ActionBarProps {
  laneId: number;
  onAction?: () => void;
}

const actions = [
  { label: "Pass", fn: (c: HarnessClient, id: number) => c.passStage(id) },
  { label: "Advance", fn: (c: HarnessClient, id: number) => c.advanceStage(id) },
  { label: "Block", fn: (c: HarnessClient, id: number) => c.blockStage(id, "manually blocked") },
  { label: "Re-enter", fn: (c: HarnessClient, id: number) => c.reenterStage(id) },
  { label: "Up", fn: (c: HarnessClient, id: number) => c.upLane(id) },
  { label: "Down", fn: (c: HarnessClient, id: number) => c.downLane(id) },
] as const;

export function ActionBar({ laneId, onAction }: ActionBarProps) {
  return (
    <div className="grid grid-cols-6 gap-1.5 mt-2">
      {actions.map((a) => (
        <ActionButton key={a.label} label={a.label} laneId={laneId} action={a.fn} onAction={onAction} />
      ))}
    </div>
  );
}

function ActionButton({
  label,
  laneId,
  action,
  onAction,
}: {
  label: string;
  laneId: number;
  action: (c: HarnessClient, id: number) => Promise<unknown>;
  onAction?: () => void;
}) {
  const { mutate, loading } = useMutation((client) =>
    action(client, laneId).then(() => onAction?.()),
  );

  return (
    <button
      onClick={mutate}
      disabled={loading}
      className="flex flex-col items-center gap-1 py-2 px-1 bg-[#0c1119] border border-[var(--line)] rounded-lg text-[var(--muted)] text-[9.5px] cursor-pointer transition-colors hover:text-white hover:border-[#2a3a52] disabled:opacity-50"
    >
      {loading ? "..." : label}
    </button>
  );
}
