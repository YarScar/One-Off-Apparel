/**
 * `@lp-ai/lib-grants` — the deterministic grant-writing layer.
 *
 * This is the package entrypoint named by `package.json`. Everything the MCP tools in
 * `apps/mcp-server/src/tools/` need is re-exported here, so a tool imports from
 * `@lp-ai/lib-grants` rather than reaching into `dist/` by path.
 *
 * Named exports only — no default export anywhere in this package.
 * NodeNext resolution requires the `.js` specifier even though the sources are `.ts`.
 */

// zod schemas + inferred types for each seed file.
export * from './schemas.js';

// Grant corpus classification: a Drive/mirror path -> funder, year, kind, and the honesty
// flags the catalog stores. Shared so the Drive walk and the local index cannot disagree
// about the same file.
export * from './catalog.js';

// Counting primitives that reproduce Python semantics. The port depends on these for parity.
export * from './py.js';

// Seed loading and the load-time integrity report.
export * from './data.js';

// Length measurement against a funder's stated limit.
export * from './limits.js';

// The figure verification work order. It returns connector calls; it never makes one.
export * from './figures.js';

// CPython `difflib.SequenceMatcher.ratio()`, ported. Carries the parity risk for the whole layer.
export * from './seq-ratio.js';

// Funder question → question bank entry.
export * from './matcher.js';

// What the layer gives back to the CALLING model when text needs shaping. No model client lives in
// this repository, and this layer does not add one — see `handback.ts` and `admin/TAD.md` §6.
export * from './handback.js';

// The two data-honesty warnings an action line may carry. Shared so `pipeline.ts` and `resize.ts`
// cannot drift on the wording.
export * from './warnings.js';

// One answer, one limit: measure, hand back, then check the rewrite for length AND figure fidelity.
export * from './resize.js';

// Form → match → KB retrieve → limit check → Markdown. Returns the figure work order; never calls a
// connector.
export * from './pipeline.js';
