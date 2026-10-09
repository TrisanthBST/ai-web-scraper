import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // jsdom uses dynamic requires that the bundler can't statically follow, so
  // keep it out of the server bundle.
  serverExternalPackages: ["jsdom"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
