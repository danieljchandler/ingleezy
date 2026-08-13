import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = "/dev-server";
export default defineConfig({
  root: projectRoot,
  envDir: path.join(projectRoot, ".vite-env"),
  plugins: [
    react(),
    visualizer({ filename: "/tmp/stats.html", template: "treemap", gzipSize: true, sourcemap: false }),
  ],
  resolve: { alias: { "@": path.join(projectRoot, "src") } },
  build: { outDir: "/tmp/dist-analyze", emptyOutDir: true },
});
