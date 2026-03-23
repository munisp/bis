# BIS PWA Design Ideas

## Chosen Design Philosophy: **Forensic Intelligence Dark**

**Design Movement:** Dark-mode enterprise intelligence platform — inspired by OSINT tools, Bloomberg Terminal, and Palantir Gotham. Clinical precision meets investigative depth.

**Core Principles:**
1. Dark navy/charcoal base with high-contrast data surfaces — data is the hero, not decoration
2. Monospace accents for IDs, hashes, and codes — reinforces the forensic/technical identity
3. Status-driven color language: green = verified, amber = pending, red = flagged, blue = in-progress
4. Sidebar-first navigation with collapsible sections — mirrors professional security tools

**Color Philosophy:**
- Background: `oklch(0.12 0.015 255)` — deep navy-charcoal
- Surface: `oklch(0.17 0.012 255)` — slightly lighter card surface
- Primary: `oklch(0.62 0.22 260)` — electric blue (trust, intelligence)
- Accent: `oklch(0.75 0.18 145)` — emerald green (verified/safe)
- Warning: `oklch(0.78 0.18 75)` — amber (pending/review)
- Danger: `oklch(0.65 0.22 25)` — crimson (flagged/risk)

**Layout Paradigm:** Left sidebar (280px) with icon + label nav groups. Main content area uses a data-grid approach — cards with dense information, not marketing whitespace.

**Signature Elements:**
1. Monospace font (JetBrains Mono) for all IDs, hashes, scores, and codes
2. Subtle horizontal scan-line texture on sidebar
3. Risk score gauge — circular arc indicator, not a bar

**Typography System:**
- Display: `Inter` 700 for page titles
- Body: `Inter` 400/500 for content
- Code/IDs: `JetBrains Mono` 400 for all technical identifiers

**Animation:** Subtle fade-in on page transitions (150ms), skeleton loaders on data fetch, pulse on live monitoring alerts.
