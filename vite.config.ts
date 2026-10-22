import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const plugins = [react(), tailwindcss(), jsxLocPlugin()];

// Build Pages versionné : PAGES_BUNDLE_VERSION=20261022-a11y produit
// assets/index-registration-20261022-a11y.{js,css}. Rollup connaît ainsi le nom
// final de l'entrée et les chunks dynamiques (xlsx) l'importent directement,
// sans renommage manuel après le build.
const pagesBundleVersion = process.env.PAGES_BUNDLE_VERSION?.trim();
if (pagesBundleVersion && !/^[\w.-]+$/.test(pagesBundleVersion)) {
  throw new Error(
    `PAGES_BUNDLE_VERSION invalide (« ${pagesBundleVersion} ») : lettres, chiffres, « . », « _ » ou « - » uniquement.`
  );
}
const pagesEntryName =
  pagesBundleVersion && `assets/index-registration-${pagesBundleVersion}`;

export default defineConfig({
  base: "./",
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: pagesEntryName
      ? {
          output: {
            entryFileNames: `${pagesEntryName}.js`,
            assetFileNames: asset =>
              asset.names.includes("index.css")
                ? `${pagesEntryName}.css`
                : "assets/[name]-[hash][extname]",
          },
        }
      : undefined,
  },
  server: {
    port: 3000,
    strictPort: false, // Will find next available port if 3000 is busy
    host: true,
    // The WebDev/sandbox public URL is a dynamic host; without this Vite
    // returns a plain "Blocked request" page before the React app loads.
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
