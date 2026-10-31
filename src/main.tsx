import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import "./lib/i18n/i18n";
import { App } from "./app/App";
import { DURATION, EASE_OUT } from "./lib/motion";
import { initialTheme } from "./lib/theme";

initialTheme();

const root = document.querySelector("#root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: DURATION.enter, ease: EASE_OUT }}
      >
        <App />
      </MotionConfig>
    </StrictMode>,
  );
}
