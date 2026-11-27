"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker (public/sw.js) pour activer le mode hors-ligne
 * (cache applicatif + synchronisation en arrière-plan). ADR — PWA.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const onLoad = () => {
      window
        .navigator.serviceWorker
        .register("/sw.js")
        .catch(() => {
          /* enregistrement non critique : le site reste utilisable en ligne */
        });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
