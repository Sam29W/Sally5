import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },
      // Static SPA build: the checkout is a single dynamic page, embedded via the SDK as
      // a modal/redirect, never server-rendered against per-request data.
      adapter: adapter({ fallback: "index.html" }),
    }),
  ],
});
