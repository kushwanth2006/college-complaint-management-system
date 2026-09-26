---
version: alpha
name: CampusDesk
description: Campus complaint tracking with paper-like cards and clear incident triage.
colors:
  ink: '#1C2541'
  paper: '#FFFDF7'
  parchment: '#F3EEE0'
  teal: '#2C6E63'
  rust: '#B0431D'
typography:
  sans:
    fontFamily: 'Inter, sans-serif'
  mono:
    fontFamily: 'IBM Plex Mono, monospace'
omitted:
  - section: spacing
    reason: Existing public/styles.css owns layout dimensions.
  - section: rounded
    reason: Existing public/styles.css owns component radii.
components:
  incident-summary: {}
---

# CampusDesk design context

The existing English product serves students reporting campus problems and staff triaging them. Preserve its paper card identity, established navigation, fonts, and spacing. No market-specific redesign is part of incident consolidation.

Runtime tokens are owned by `public/styles.css` (`:root`); this document mirrors the palette used by the incident component. Inter carries body text, existing display fonts carry headings, and IBM Plex Mono identifies records. Incident summaries reuse paper, ink, teal, and rust variables rather than introducing another palette.

The shared `incidentSummary` renderer in `public/Script.js` displays the incident ID, affected students, report count, and explicit urgent text in all complaint views. Use a quiet left border for grouping and rust plus text for immediate attention. Long titles wrap; no new fixed heights, motion, or overlays. Staff linked reports use native keyboard-accessible details/summary disclosure. Existing cards and update controls remain the canonical interaction owners.

Do preserve individual student records and make group-wide update consequences visible. Do not imply that multiple reports represent multiple separate incidents, or rely on color alone to convey urgency.
