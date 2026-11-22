// Build-time rendering of the public pages (scripts/prerender.mjs): the same providers and routes as the
// browser, with a StaticRouter in place of BrowserRouter, so a visitor that does not run JavaScript still
// receives each page's text and <head> tags. Nothing here runs in the browser (src/main.tsx).
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import type { HelmetServerState } from "react-helmet-async";
import { AppProviders, AppRoutes } from "./App";

export interface RenderResult {
  /** The markup of <div id="root">. */
  html: string;
  /** The <title>, <meta>, <link> tags and <html> attributes set by <Seo /> (react-helmet-async). */
  helmet: HelmetServerState | null;
}

export function render(url: string): RenderResult {
  const helmetContext: { helmet?: HelmetServerState | null } = {};
  const html = renderToString(
    <AppProviders helmetContext={helmetContext}>
      <StaticRouter location={url}>
        <AppRoutes />
      </StaticRouter>
    </AppProviders>,
  );
  return { html, helmet: helmetContext.helmet ?? null };
}
