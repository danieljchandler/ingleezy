import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // IBM Plex Sans Arabic is a dual-script family — its Latin was drawn
        // to harmonise with the Arabic, so one stack carries the whole chrome.
        // Inter is for English CONTENT; Archivo Black for display accents.
        sans: ["IBM Plex Sans Arabic", "Inter", "sans-serif"],
        heading: ["IBM Plex Sans Arabic", "Inter", "sans-serif"],
        arabic: ["IBM Plex Sans Arabic", "Inter", "sans-serif"],
        english: ["Inter", "IBM Plex Sans Arabic", "sans-serif"],
        display: ["Archivo Black", "Inter", "sans-serif"],
        // Legacy alias (transcript surfaces) — folded into the chrome family.
        cairo: ["IBM Plex Sans Arabic", "Inter", "sans-serif"],
      },
      fontSize: {
        // Locked typographic scale — 1.25 ratio, Lahja rhythm
        "caption": ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
        "overline": ["0.6875rem", { lineHeight: "0.875rem", letterSpacing: "0.12em" }],
        "body-sm": ["0.875rem", { lineHeight: "1.4rem" }],
        "body": ["1rem", { lineHeight: "1.6rem" }],
        "subtitle": ["1.125rem", { lineHeight: "1.65rem", letterSpacing: "-0.005em" }],
        "title": ["1.5rem", { lineHeight: "1.9rem", letterSpacing: "-0.015em" }],
        "headline": ["2rem", { lineHeight: "2.35rem", letterSpacing: "-0.02em" }],
        "display": ["2.75rem", { lineHeight: "3rem", letterSpacing: "-0.025em" }],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        periwinkle: "hsl(var(--periwinkle))",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
          cream: "hsl(var(--card-cream))",
        },
        "desert-red": "hsl(var(--desert-red))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
        "3xl": "calc(var(--radius) + 12px)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        card: "var(--shadow-card)",
        button: "var(--shadow-button)",
        topic: "var(--shadow-topic)",
        "topic-hover": "var(--shadow-topic-hover)",
      },
      transitionTimingFunction: {
        // Lahja Motion Language — single canonical easing
        lahja: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // ── Lahja Motion Language ──
        // 1. fade-up — content arrival (text, lists, panels)
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // 2. scale-in — cards, tiles, badges
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        // 3. slide-in — sheets, drawers, overlays (from right)
        "slide-in": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "slide-in-bottom": {
          "0%": { transform: "translateY(100%)" },
          "100%": { transform: "translateY(0)" },
        },
        // Legacy alias — keep existing call sites working, route to fade-up
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Playful hints on VocabularyCard (tap-to-hear cue, replay button).
        "bounce-gentle": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        "wiggle": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "25%": { transform: "rotate(-7deg)" },
          "75%": { transform: "rotate(7deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        // Lahja Motion Language — all use the lahja easing, tuned durations
        "fade-up": "fade-up 360ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in": "slide-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in-bottom": "slide-in-bottom 320ms cubic-bezier(0.16, 1, 0.3, 1) both",
        // Alias
        "fade-in": "fade-up 360ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "bounce-gentle": "bounce-gentle 1.8s ease-in-out infinite",
        "wiggle": "wiggle 0.5s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
