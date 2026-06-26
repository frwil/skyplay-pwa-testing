import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  // Required: use webpack bundler for PWA plugin compatibility
  turbopack: {},
  // Allow ngrok tunnel for mobile testing
  allowedDevOrigins: ['localhost',
    '*.ngrok-free.app','*.trycloudflare.com'],
};

const pwaConfig = withPWA({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    document: "/offline",
  },
});

export default pwaConfig(nextConfig);
