import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// SPA mode: the build emits a static shell (_shell.html) and no server is needed.
// HTTPS is opt-in (`bun run dev:https` sets DEV_HTTPS=1): phone cameras need a secure context.
const useHttps = process.env["DEV_HTTPS"] === "1";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { host: true },
  plugins: [
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
    tailwindcss(),
    ...(useHttps ? [basicSsl()] : []),
  ],
});
