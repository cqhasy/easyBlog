import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: ["es2021", "safari15.4", "chrome100", "firefox100"],
  },
});
