import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

// Хост задаётся окружением, а не кодом: ADR-0002 требует, чтобы перенос
// статики на любой другой хост оставался вечерней работой.
const site = process.env.SITE_URL ?? "https://shved-yoga.dev.coventpro.ai";

export default defineConfig({
  site,
  trailingSlash: "never",
  build: {
    inlineStylesheets: "auto",
    format: "file",
  },
  // /privacy из карты сайта исключён: страница noindex.
  integrations: [sitemap({ filter: (page) => !page.includes("/privacy") })],
  vite: {
    plugins: [tailwindcss()],
  },
});
