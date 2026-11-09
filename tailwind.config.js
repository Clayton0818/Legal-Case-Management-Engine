/** @type {import('tailwindcss').Config} */

// GlassMinimal3D theme (direction 7, founder-approved 2026-11-03): a calm,
// near-mono palette in the spirit of Apple's restraint, with frosted-glass
// surfaces and a restrained 3D hover (see the `.lux` rules and `.glass-*`
// classes in globals.css). Supersedes the "Espresso & champagne" theme.
//
// Exactly like that earlier theme, `slate` is REMAPPED so every existing
// page written with slate-* utilities picks up the new look without a
// per-page edit. `sky` / `blue` / `indigo` are remapped to `glassBrand`,
// whose every step is derived from ONE CSS variable, `--brand` (set in
// globals.css, default #5E5CE6, overridable per tenant -- see
// src/app/admin/layout.tsx, which reads firmSettings.brandAccentColor and
// sets `--brand` inline). That's what makes "color code the page" a single
// setting: every indigo/sky/blue-colored link, pill and button site-wide
// re-tints from one value, with no other code changes.
//
// `espresso` / `champagne` / `ivory` / `taupe` keep their names but are
// re-pointed to the light shell's values -- see the comment on them below.
const glassGray = {
  50: "#FBFBFC",
  100: "#F2F2F4",
  200: "#E5E5E8",
  300: "#D1D1D6",
  400: "#AEAEB4",
  500: "#74747A",
  600: "#5B5B61",
  700: "#454549",
  800: "#2E2E31",
  900: "#1D1D1F",
  950: "#121214",
};

// Every step is derived from the single `--brand` CSS variable via
// color-mix(), so the whole scale re-tints from one value. `color-mix()` is
// a plain string at build time (no JS runtime needed) and is resolved by
// the browser, so this is safe for `next build` with no network access.
const glassBrand = {
  50: "color-mix(in srgb, var(--brand, #5E5CE6) 6%, white)",
  100: "color-mix(in srgb, var(--brand, #5E5CE6) 12%, white)",
  200: "color-mix(in srgb, var(--brand, #5E5CE6) 22%, white)",
  300: "color-mix(in srgb, var(--brand, #5E5CE6) 38%, white)",
  400: "color-mix(in srgb, var(--brand, #5E5CE6) 58%, white)",
  500: "var(--brand, #5E5CE6)",
  600: "color-mix(in srgb, var(--brand, #5E5CE6) 88%, black)",
  700: "color-mix(in srgb, var(--brand, #5E5CE6) 72%, black)",
  800: "color-mix(in srgb, var(--brand, #5E5CE6) 55%, black)",
  900: "color-mix(in srgb, var(--brand, #5E5CE6) 38%, black)",
  950: "color-mix(in srgb, var(--brand, #5E5CE6) 22%, black)",
};

export default {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: glassGray,
        sky: glassBrand,
        blue: glassBrand,
        indigo: glassBrand,
        // Light "calm" shell (founder direction 2026-11-09: every page,
        // demo included, uses the light, airy look -- white cards on a soft
        // pastel field, dark text, one brand accent). These four token
        // families were the DARK-surface vocabulary of earlier themes
        // (espresso = dark surfaces, ivory = text on them, taupe = muted
        // text on them, champagne = accent). Exactly like the slate remap
        // above, they are re-pointed rather than rewritten page by page, so
        // every client-facing page that used them (portal, chat, demo,
        // landing) flips to light without edits:
        //   espresso -> white / near-white surfaces
        //   ivory    -> near-black text
        //   taupe    -> neutral grays for secondary text
        //   champagne -> the tenant brand accent (DEFAULT/ink are text-safe
        //               on white; `light` is a deeper hover shade)
        // `text-espresso-deep` was dark text on a gold button; it now
        // resolves to near-white, which is exactly right on a brand button.
        espresso: {
          DEFAULT: "#FFFFFF",
          deep: "#FBFBFC",
          panel: "#FFFFFF",
          bubble: "#F2F2F5",
        },
        champagne: {
          DEFAULT: "var(--brand, #5E5CE6)",
          light: "color-mix(in srgb, var(--brand, #5E5CE6) 82%, black)",
          ink: "color-mix(in srgb, var(--brand, #5E5CE6) 72%, black)",
        },
        ivory: {
          DEFAULT: "#1D1D1F",
          bright: "#121214",
          text: "#1D1D1F",
        },
        taupe: {
          DEFAULT: "#6E6E73",
          dim: "#86868B",
          faint: "#98989D",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        display: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      borderRadius: {
        "4xl": "2rem",
      },
    },
  },
  plugins: [],
}
