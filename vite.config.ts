import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Ruta base pública. En GitHub Pages el sitio vive en /litomask/, así que el flujo de
// despliegue exporta VITE_BASE=/litomask/. En local y en un servidor propio queda "/".
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/",
});
