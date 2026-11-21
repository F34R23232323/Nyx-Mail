import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dirname, "../.env") });
dotenv.config({ path: path.resolve(dirname, ".env.local") });
dotenv.config();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    "@nyxmail/crypto",
    "@nyxmail/db",
    "@nyxmail/server",
    "@nyxmail/shared",
  ],
  experimental: {
    serverComponentsExternalPackages: [
      "@prisma/client",
      "prisma",
      "argon2",
      "libsodium-wrappers",
      "isomorphic-dompurify",
      "jsdom",
      "mailparser",
      "nodemailer",
      "imapflow",
      "otplib",
      "qrcode",
    ],
    instrumentationHook: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
