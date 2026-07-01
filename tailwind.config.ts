import type { Config } from "tailwindcss";

/**
 * Tailwind maps the semantic design tokens from docs/spec/02_DESIGN.md into theme
 * extensions. Every color/radius/size references a CSS variable defined in
 * src/app/globals.css under [data-theme="light"] / [data-theme="dark"], so components
 * only ever reference token names (never raw values).
 */
const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        primary: "var(--primary)",
        "primary-fg": "var(--primary-fg)",
        "info-tint": "var(--info-tint)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        "focus-ring": "var(--focus-ring)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        7: "var(--space-7)",
        "control-h": "var(--control-h)",
        "hit-min": "var(--hit-min)",
      },
      fontFamily: {
        mono: "var(--font-mono)",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
      },
      fontSize: {
        xs: "0.75rem",
        sm: "0.8125rem",
        base: "0.875rem",
        md: "1rem",
        lg: "1.125rem",
        xl: "1.375rem",
        "2xl": "1.75rem",
      },
      ringColor: {
        focus: "var(--focus-ring)",
      },
    },
  },
  plugins: [],
};

export default config;
