import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Fitron: the original prototype and generated Prisma client.
    "prototype/**",
    // The marketing site is exported from the design tool as-is (it bundles three.js).
    "public/site/**",
    // The AI Trainer member app is the design tool's export too, with React bundled in vendor/.
    "public/trainer/**",
    "src/generated/**",
    // Output of the end-to-end tests.
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
