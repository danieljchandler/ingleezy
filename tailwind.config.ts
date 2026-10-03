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
        // Two jobs per script. The interface is Funnel Sans, falling through
        // to IBM Plex Sans Arabic for every Arabic glyph. Headlines are the
        // book serif: Libre Baskerville over Noto Naskh Arabic. Funnel Display
        // is the wordmark only.
        sans: ["Funnel Sans", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        heading: ["Libre Baskerville", "Noto Naskh Arabic", "Georgia", "serif"],
        serif: ["Libre Baskerville", "Noto Naskh Arabic", "Georgia", "serif"],
        naskh: ["Noto Naskh Arabic", "Libre Baskerville", "Georgia", "serif"],
        arabic: ["Funnel Sans", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        english: ["Funnel Sans", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        display: ["Libre Baskerville", "Noto Naskh Arabic", "Georgia", "serif"],
        wordmark: ["Funnel Display", "Funnel Sans", "system-ui", "sans-serif"],
        // Legacy alias (transcript surfaces) — folded into the chrome family.
        cairo: ["Funnel Sans", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Locked typographic scale — 1.25 ratio. No letter-spacing anywhere in
        // it: these sizes carry Arabic most of the time, and tracking breaks
        // the joins between Arabic letters. Line heights are set for Arabic,
        // which needs more room than Latin for its ascenders and dots.
        "caption": ["0.75rem", { lineHeight: "1.15rem" }],
        "overline": ["0.6875rem", { lineHeight: "1rem" }],
        "body-sm": ["0.875rem", { lineHeight: "1.4rem" }],
        "body": ["1rem", { lineHeight: "1.6rem" }],
        "subtitle": ["1.125rem", { lineHeight: "1.75rem" }],
        "title": ["1.5rem", { lineHeight: "2.15rem" }],
        "headline": ["2rem", { lineHeight: "2.75rem" }],
        "display": ["2.75rem", { lineHeight: "3.6rem" }],
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
          // Sage TEXT on the sage tint.
          ink: "hsl(var(--success-ink))",
        },
        clay: {
          // Clay TEXT on the clay tint; the fill is `destructive`.
          ink: "hsl(var(--clay-ink))",
        },
        // Quiet fills behind tags, icons and states.
        tint: {
          firoza: "hsl(var(--tint-firoza))",
          gold: "hsl(var(--tint-gold))",
          sage: "hsl(var(--tint-sage))",
          clay: "hsl(var(--tint-clay))",
          sand: "hsl(var(--tint-sand))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        periwinkle: "hsl(var(--periwinkle))",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          // For accent-coloured text. The DEFAULT is a fill: as body copy on
          // the pale gold it usually sits on, it is about 2:1.
          ink: "hsl(var(--accent-ink))",
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
