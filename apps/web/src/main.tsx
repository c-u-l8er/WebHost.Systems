import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SupabaseAuthProvider } from "./lib/SupabaseAuthProvider";
import { WorkspaceProvider } from "./lib/WorkspaceProvider";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SupabaseAuthProvider>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </SupabaseAuthProvider>
  </StrictMode>,
);
