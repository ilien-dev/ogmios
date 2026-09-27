import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import "./lib/i18n/i18n";
import { App } from "./app/App";
import { initialTheme } from "./lib/theme";

initialTheme();

const root = document.querySelector("#root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
