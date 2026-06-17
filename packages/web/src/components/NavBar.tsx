"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface HealthStatus {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: string }>;
}

export function NavBar() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/health/deep");
        setHealth(await res.json());
      } catch {
        setHealth({ ok: false, checks: {} });
      }
    };
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, []);

  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/audit", label: "Audit Log" },
  ];

  return (
    <nav className="flex items-center gap-4 mb-5 border-b border-gray-800 pb-3">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`text-sm px-3 py-1 rounded ${
            pathname === link.href
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
        >
          {link.label}
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            health === null
              ? "bg-gray-500"
              : health.ok
                ? "bg-green-400"
                : "bg-red-400 animate-pulse"
          }`}
        />
        <span className="text-xs text-gray-500">
          {health === null ? "checking..." : health.ok ? "healthy" : "unhealthy"}
        </span>
      </div>
    </nav>
  );
}
