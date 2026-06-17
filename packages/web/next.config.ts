import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@harness/sdk", "@harness/types"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8090/api/:path*",
      },
    ];
  },
};

export default nextConfig;
