import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Remove the static loader once React mounts
const removeLoader = () => {
  const loader = document.getElementById('app-loader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => loader.remove(), 300);
  }
};

// The static tags in index.html are only a fallback for crawlers that do not run
// JavaScript. Once React mounts, <Seo /> (react-helmet-async) is the single source
// of truth, so drop the static copies to avoid duplicate description / Open Graph tags.
const HELMET_OWNED_SELECTORS = [
  'meta[name="description"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:url"]',
  'meta[property="og:type"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
];

const removeStaticHeadDuplicates = () => {
  for (const selector of HELMET_OWNED_SELECTORS) {
    document
      .head
      .querySelectorAll(`${selector}:not([data-rh])`)
      .forEach((el) => el.remove());
  }
};

removeStaticHeadDuplicates();

createRoot(document.getElementById("root")!).render(<App />);
removeLoader();
