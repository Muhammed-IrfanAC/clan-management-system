import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Discord boundary. Only the transport talks to discord.com, and browser code may see the message
  // TYPES but never the server API behind `@/lib/discord` (it pulls in the Supabase client).
  {
    // Server code only: client code is already kept off `@/lib/discord` by the import rule below.
    files: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
    ignores: ["src/lib/discord/transport.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "Literal[value=/discord(app)?\\.com\\/api/]",
        message: "Only src/lib/discord/transport.ts may call the Discord API.",
      }],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/page.tsx", "src/app/**/layout.tsx", "src/lib/stores/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@/lib/discord", message: "Client code may import only @/lib/discord/types or /format." }],
        patterns: [{
          group: ["@/lib/discord/*", "!@/lib/discord/types", "!@/lib/discord/format", "!@/lib/discord/roles"],
          message: "Client code may import only @/lib/discord/types, /format or /roles.",
        }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
