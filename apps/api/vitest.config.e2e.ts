import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // The suites share one local database and its sample logins, so they run one after another.
    fileParallelism: false,
    // The suites log in as sample users who have agreed to no terms, so the server's refusal
    // of such users (LEGAL_GATE) is off for the run. legal.e2e-spec.ts switches it on itself.
    // AI: the tests never call Anthropic. The fake engine answers (AI_ENGINE=fake), and AI is
    // off for the run so the other suites behave as before; ai.e2e-spec.ts switches it on itself.
    env: { LEGAL_GATE: 'off', AI_ENGINE: 'fake', AI_FEATURES: 'off' },
  },
});
