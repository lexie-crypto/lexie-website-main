// ✅ ACTIVATE RAILGUN DEBUG LOGGING IMMEDIATELY
console.log("🔍 [DEBUG] Activating Railgun debug logging...");
if (typeof window !== "undefined") {
  window.localStorage.debug = "railgun:*";
  console.log(
    "🔍 [DEBUG] Railgun debug logging activated in browser localStorage"
  );
}

import React from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import App from "./App";
import { PostHogProvider } from "posthog-js/react";
import { POSTHOG_CONFIG } from "./config/environment.js";

const options = {};

const root = createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <PostHogProvider
      apiKey={POSTHOG_CONFIG.apiKey}
      options={{ ...POSTHOG_CONFIG.options, ...options }}
    >
      <App />
    </PostHogProvider>
  </React.StrictMode>
);
