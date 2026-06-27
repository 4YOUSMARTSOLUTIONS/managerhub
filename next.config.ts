import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "bottom-right",
  },
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
