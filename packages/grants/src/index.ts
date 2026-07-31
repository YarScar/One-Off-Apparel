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
