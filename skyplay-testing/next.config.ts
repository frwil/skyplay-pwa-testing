import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  // Required: use webpack bundler for PWA plugin compatibility
  turbopack: {},
  // Allow ngrok tunnel for mobile testing
  allowedDevOrigins: ["fc3f-143-105-152-80.ngrok-free.app"],
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
