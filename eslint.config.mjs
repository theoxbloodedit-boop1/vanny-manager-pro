import nextVitalsConfig from "eslint-config-next/core-web-vitals";
import nextTsEslintConfig from "eslint-config-next/typescript";

/**
 * ESLint 9 flat config.
 *
 * `core-web-vitals` is the Next.js rule set; `typescript` adds the TS parser
 * and plugin. If a future toolchain change breaks the TS rules, the core set
 * still runs and CI still fails on real problems.
 */
const config = [
  ...nextVitalsConfig,
  ...nextTsEslintConfig,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/sw.js",
      "next-env.d.ts",
      "src/db/migrations/**",
    ],
  },
];

export default config;
