import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter Variable", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        raised: "rgb(var(--raised) / <alpha-value>)",
        raised2: "rgb(var(--raised2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        borderStrong: "rgb(var(--borderStrong) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        accent2: "rgb(var(--accent2) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        mint: "rgb(var(--mint) / <alpha-value>)",
        success: "rgb(var(--mint) / <alpha-value>)",
        danger: "#FF6B7D",
        warning: "#F5B85C",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.16)",
        glow: "0 0 0 1px rgba(109,74,255,.22), 0 10px 40px rgba(109,74,255,.12)",
      },
      borderRadius: {
        xl2: "1.15rem",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up .18s ease-out both",
        shimmer: "shimmer 1.5s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
