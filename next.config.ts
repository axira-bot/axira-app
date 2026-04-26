import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Keep module resolution scoped to this app (prevents resolving from /Users/axira).
    root: __dirname,
  },
};

export default nextConfig;
