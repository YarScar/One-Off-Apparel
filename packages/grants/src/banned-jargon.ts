/**
 * banned-jargon.ts — the one list of nonprofit-jargon words every draft check enforces.
 *
 * Canonical per `docs/PLAYBOOK.md` (which `references/style.md` explicitly defers to on any
 * conflict) — the same 8 words appear at PLAYBOOK.md:64, :79, :113. `count.mjs` and `gapfill.mjs`
 * import this constant instead of hand-copying the list, so the two enforcement scripts and the
 * doc stay in lockstep. "Survivable" is a related but distinct check — PLAYBOOK.md and style.md
 * both list it as an emotional-reach word to cut, never as jargon; do not add it here.
 */
export const BANNED_JARGON = [
  'transformative',
  'innovative',
  'holistic',
  'leverage',
  'ecosystem',
  'move the needle',
  'at the intersection of',
  'reimagine',
] as const;
