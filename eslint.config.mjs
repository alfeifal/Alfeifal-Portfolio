import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "public/sw.js", "next-env.d.ts"] },
  {
    rules: {
      "react-hooks/exhaustive-deps": "off",
      // Syncing local state from fetched data / external stores inside effects is intentional here.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // The German course is a preserved third-party module; its original patterns are kept as-is.
    files: ["src/modules/german/**"],
    rules: { "react-hooks/purity": "off", "react-hooks/immutability": "off", "react-hooks/set-state-in-effect": "off" },
  },
];
export default config;
