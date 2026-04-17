/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // [START] theme — class-based dark mode driven by html.dark
  darkMode: "class",
  // [END]
  theme: {
    extend: {
      colors: {
        owl: {
          50: "#f8f5ef",
          100: "#efe8d4",
          500: "#8a6d3b",
          700: "#5a4423",
          900: "#2d1e0a",
        },
        // [START] ovo semantic tokens — backed by CSS custom properties
        "ovo-bg": "var(--bg)",
        "ovo-surface": "var(--surface)",
        "ovo-surface-solid": "var(--surface-solid)",
        "ovo-text": "var(--text)",
        "ovo-muted": "var(--text-muted)",
        "ovo-border": "var(--border)",
        "ovo-accent": "var(--accent)",
        "ovo-accent-hover": "var(--accent-hover)",
        "ovo-accent-ink": "var(--accent-ink)",
        "ovo-user": "var(--user-bubble)",
        "ovo-user-ink": "var(--user-bubble-ink)",
        "ovo-assistant": "var(--assistant-bubble)",
        "ovo-chip": "var(--chip)",
        "ovo-chip-border": "var(--chip-border)",
        "ovo-nav-active": "var(--nav-active)",
        "ovo-nav-active-hover": "var(--nav-active-hover)",
        // [END]
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
