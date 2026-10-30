import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [solid()],
  build: { outDir: "../dist/ui", emptyOutDir: false, target: "es2022" },
});
