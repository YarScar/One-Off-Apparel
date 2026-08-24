/**
 * seed-io.ts — shared file-reading primitives for every seed loader in this package.
 *
 * Extracted from `data.ts` under #8 (WP #333) so `figures.ts` can load `figure_checks.json` without
 * creating a value-level import cycle back into `data.ts`. `data.ts` already imports `FIGURE_CHECKS`
 * from `figures.ts` — safe today only because that read is function-scoped, never at module
 * evaluation (see `data.ts`'s header comment). Had `figures.ts` instead called back into `data.ts` for
 * its own seed constant, computed eagerly at `figures.ts`'s OWN module-evaluation time, the two
 * modules' relative load order would decide whether `data.ts`'s `const SEED_DIR` had been assigned
 * yet — a real TDZ hazard, not the kind of cycle the existing comment says is safe. This module has no
 * imports from either `data.ts` or `figures.ts`, so both can depend on it with no cycle at all.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The seed directory, resolved relative to this module.
 *
 * `dist/` mirrors `src/`, so `'..'` lands on the package root from either location — `src/seed-io.ts`
 * under vitest and `dist/seed-io.js` at runtime. In the deployed image this resolves under
 * `packages/grants/`, which the mcp-server Dockerfile runner already copies wholesale
 * (`COPY --from=builder /workspace/packages ./packages`).
 */
export const SEED_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'seed');
export const FORMS_DIR = join(SEED_DIR, 'forms');

export interface SafeParser<T> {
  safeParse: (value: unknown) => {
    success: boolean;
    data?: T;
    error?: { issues: { path: (string | number)[]; message: string }[] };
  };
}

export function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`grant seed: cannot read ${path} — ${reason}`, { cause: err });
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`grant seed: ${path} is not valid JSON — ${reason}`, { cause: err });
  }
}

export function parseSeed<T>(path: string, schema: SafeParser<T>): T {
  const parsed = schema.safeParse(readJson(path));
  if (!parsed.success || parsed.data === undefined) {
    const issues = (parsed.error?.issues ?? [])
      .slice(0, 10)
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`grant seed: ${path} failed validation\n${issues}`);
  }
  return parsed.data;
}
