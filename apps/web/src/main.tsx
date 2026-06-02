import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppProviders } from "./app/providers";
import { App } from "./app/router";

import "./shared/styles/app.css";

const container = document.querySelector("#root");

if (!container) {
  throw new Error("The root element is missing.");
}

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
