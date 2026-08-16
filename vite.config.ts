import { cpSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/Research-Assistant/",
  plugins: [
    react(),
    {
      name: "copy-legacy-scripts",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const requestPath = request.url?.split("?", 1)[0];
          if (!requestPath?.startsWith("/js/")) {
            next();
            return;
          }

          const scriptsRoot = resolve(__dirname, "js");
          const filePath = resolve(__dirname, requestPath.slice(1));
          if (!filePath.startsWith(scriptsRoot) || !existsSync(filePath)) {
            next();
            return;
          }

          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.end(readFileSync(filePath));
        });
      },
      closeBundle() {
        cpSync(resolve(__dirname, "js"), resolve(__dirname, "dist/js"), {
          recursive: true,
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        plate96: resolve(__dirname, "plate96.html"),
        "plate96-analyze": resolve(__dirname, "plate96-analyze.html"),
      },
    },
  },
});
