import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Landing } from "./Landing";
import "./styles.css";

function Root() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/room" ? <App /> : <Landing />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
