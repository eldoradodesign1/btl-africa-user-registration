import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator && (import.meta.env.PROD || window.location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("./sw.js?v=4", { updateViaCache: "none" }).catch((error: unknown) => {
      console.error("Échec de l’enregistrement du service worker", error);
    });
  });
}
