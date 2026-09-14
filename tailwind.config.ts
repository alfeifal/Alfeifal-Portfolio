import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Personal OS palette (calm, high-contrast, no gradients)
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-fg": "rgb(var(--accent-fg) / <alpha-value>)",
        positive: "rgb(var(--positive) / <alpha-value>)",
        negative: "rgb(var(--negative) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        // German module palette (preserved from the original project)
        ink: "#1B1D24",
        paper: "#F6F6F3",
        line: "#E3E4DE",
        primary: { DEFAULT: "#2F4BD6", soft: "#E8EBFB", deep: "#213599" },
        good: { DEFAULT: "#1E8A5A", soft: "#E3F4EB" },
        bad: { DEFAULT: "#C43D2A", soft: "#FBE8E4" },
        warm: { DEFAULT: "#E0961E", soft: "#FCF1DC" },
        m0: "#C43D2A", m1: "#E0961E", m2: "#D4B400", m3: "#1E8A5A", m4: "#2F4BD6",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
