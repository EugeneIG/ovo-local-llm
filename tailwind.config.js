/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
