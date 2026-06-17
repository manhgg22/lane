import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { HarnessClient } from "../client";

const HarnessContext = createContext<HarnessClient | null>(null);

export function useHarnessClient(): HarnessClient {
  const client = useContext(HarnessContext);
  if (!client) throw new Error("useHarnessClient must be used within HarnessProvider");
  return client;
}

export function HarnessProvider({
  baseUrl,
  children,
}: {
  baseUrl: string;
  children: ReactNode;
}) {
  const client = useMemo(() => new HarnessClient(baseUrl), [baseUrl]);
  return (
    <HarnessContext value={client}>
      {children}
    </HarnessContext>
  );
}
