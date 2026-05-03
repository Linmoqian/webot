/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import postcssNesting from "postcss-nesting";

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [postcssNesting()],
    },
  },
  server: {
    host: true,
    port: 4290,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
});
