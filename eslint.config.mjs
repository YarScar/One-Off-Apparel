import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Leading `**/` matters: flat-config ignore globs resolve against the directory
    // holding this file, so the bare `dist/**` form covered only a `dist` at the repo
    // root and left every workspace package's build output to be linted. Running
    // `eslint apps/hq` surfaced ~110 parsing errors out of `apps/hq/.next/server`,
    // none of them about source code.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/generated/**',
      // Next.js writes this and its triple-slash reference; `next lint` excludes it, so
      // a direct `eslint apps/hq` should too rather than reporting on generated code.
      '**/next-env.d.ts',
      // Build-tool config, outside every tsconfig's `include`, so `strictTypeChecked`
      // cannot type-check them and the parser reports each as "not found by the project
      // service" rather than as a finding. `next lint` skips them for the same reason;
      // this makes a direct `eslint <pkg>` agree with it.
      'eslint.config.mjs',
      '**/next.config.mjs',
      '**/postcss.config.mjs',
    ],
  },
);
