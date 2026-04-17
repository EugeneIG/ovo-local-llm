import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import "./index.css";

// [START] Phase 7 — pet window router.
// Detect via URL param (?window=pet) — available synchronously before any Tauri
// API resolves. Pet window mounts PetApp instead of the full AppShell.
const params = new URLSearchParams(window.location.search);
const isPetWindow = params.get("window") === "pet";

if (isPetWindow) {
  // Lazy-import so the main bundle doesn't include pet code in the main window.
  const { PetApp } = await import("./pet/PetApp");
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <PetApp />
    </React.StrictMode>,
  );
} else {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
// [END]
