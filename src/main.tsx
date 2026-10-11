import React from "react";
import ReactDOM from "react-dom/client";
import DesktopApp from "./DesktopApp";
import { ContextStoreProvider } from "./components/Context";
import { ToastProvider } from "./components/Toast";
import "./styles.css";
import "./desktop-shell.css";
import "./styles/accessibility.css";
import "./styles/layout.css";
import "./styles/settings.css";
import "./styles/leftNav.css";
import "./styles/topbar.css";
import "./styles/browser.css";
import "./tailwind.css";

// Apply the saved theme before first paint to avoid a flash.
const savedTheme = localStorage.getItem("NEXUS_THEME");
document.documentElement.setAttribute("data-theme", savedTheme === "light" ? "light" : "dark");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <ContextStoreProvider>
        <DesktopApp />
      </ContextStoreProvider>
    </ToastProvider>
  </React.StrictMode>,
);
