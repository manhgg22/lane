import { useState, useEffect, useCallback, useRef } from "react";
import type { Lane, StageRun, LaneEvent, SSEEvent } from "@harness/types";
import { useHarnessClient } from "./provider";
import type { HarnessClient } from "../client";

export function useLanes(): {
  lanes: Lane[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const client = useHarnessClient();
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const doFetch = useCallback(() => {
    setLoading(true);
    client
      .getLanes()
      .then((data) => {
        setLanes(data);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [client]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return { lanes, loading, error, refetch: doFetch };
}

export function useLane(id: number): {
  lane: (Lane & { stageRuns: StageRun[] }) | null;
  events: LaneEvent[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const client = useHarnessClient();
  const [lane, setLane] = useState<(Lane & { stageRuns: StageRun[] }) | null>(null);
  const [events, setEvents] = useState<LaneEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const doFetch = useCallback(() => {
    setLoading(true);
    Promise.all([client.getLane(id), client.getEvents(id)])
      .then(([laneData, eventsData]) => {
        setLane(laneData);
        setEvents(eventsData);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [client, id]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return { lane, events, loading, error, refetch: doFetch };
}

export function useSSE(handler: (event: SSEEvent) => void): void {
  const client = useHarnessClient();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = client.subscribe((event) => handlerRef.current(event));
    return unsub;
  }, [client]);
}

export function useMutation<T>(
  action: (client: HarnessClient) => Promise<T>,
): {
  mutate: () => void;
  loading: boolean;
  error: Error | null;
  data: T | null;
} {
  const client = useHarnessClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<T | null>(null);

  const mutate = useCallback(() => {
    setLoading(true);
    setError(null);
    action(client)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [client, action]);

  return { mutate, loading, error, data };
}
