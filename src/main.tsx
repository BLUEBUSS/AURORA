import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/research.css";
import "./styles/evidence.css";
import "./styles/pages.css";
import "./styles/welcome.css";
import "./styles/sidebar-hierarchy.css";
import "./styles/theme-transition.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
