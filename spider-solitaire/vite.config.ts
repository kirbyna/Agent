import { defineConfig } from "vite";

// Relative asset paths, so the same build works at a sub-path (GitHub Pages serves this at
// /Agent/) and inside the iOS app (served from the root).
export default defineConfig({
  base: "./",
});
