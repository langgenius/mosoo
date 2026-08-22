import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProviders } from "./app/providers";
import { App } from "./app/router";
import { initI18n } from "./shared/i18n";

import "./shared/styles/app.css";

const container = document.querySelector("#root");

if (!container) {
  throw new Error("The root element is missing.");
}

// Initialise i18n before rendering so the first paint already uses the
// correct locale. English stays in the entry chunk; other locales load only
// their selected catalog instead of making every page download all catalogs.
void initI18n().then(() => {
  createRoot(container).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
});
