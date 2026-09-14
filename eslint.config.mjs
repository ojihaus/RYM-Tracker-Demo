import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    files: ["tests/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      // These effects synchronize controlled widgets with external data/browser state.
      "react-hooks/set-state-in-effect": "off",
      // RYM serves artwork from changing CDN paths; keep its lazy-loaded originals.
      "@next/next/no-img-element": "off",
    },
  },
]);
