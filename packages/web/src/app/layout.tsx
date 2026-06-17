import type { Metadata } from "next";
import { Providers } from "./providers";
import { NavBar } from "@/components/NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Feature Harness",
  description: "Parallel lane orchestrator for AI agent workflows",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen p-5">
        <Providers>
          <NavBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
