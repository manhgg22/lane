"use client";

import { HarnessProvider } from "@harness/sdk/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <HarnessProvider baseUrl="">
      {children}
    </HarnessProvider>
  );
}
