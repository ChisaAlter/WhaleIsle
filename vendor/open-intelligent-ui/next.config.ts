import type { NextConfig } from "next";
import { BASE_PATH } from "./src/lib/base-path";

const nextConfig: NextConfig = {
  basePath: BASE_PATH || undefined,
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  async redirects() {
    // With a base path, the deployment's own domain still opens the demo at its root.
    return BASE_PATH ? [{ source: "/", destination: BASE_PATH, basePath: false, permanent: false }] : [];
  },
};

export default nextConfig;
