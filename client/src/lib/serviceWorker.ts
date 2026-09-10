declare const __BIS_BUILD_VERSION__: string;

const VERSION_PATTERN = /^[A-Za-z0-9._-]{7,128}$/;
const VERSION_STORAGE_KEY = "bis.service-worker.reloaded-version";

/**
 * The version is supplied at build time from the deployed revision. It must be
 * safe to include in a service-worker script URL and cache name; unknown
 * values fail closed to a stable, non-empty development label.
 */
export const BIS_BUILD_VERSION = VERSION_PATTERN.test(__BIS_BUILD_VERSION__)
  ? __BIS_BUILD_VERSION__
  : "development";

function canUseServiceWorker(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

function reloadForActivatedVersion(version: string): void {
  try {
    if (window.sessionStorage.getItem(VERSION_STORAGE_KEY) === version) return;
    window.sessionStorage.setItem(VERSION_STORAGE_KEY, version);
  } catch {
    // Storage may be unavailable in a hardened browser context. A reload still
    // guarantees that the newly activated worker controls a freshly loaded shell.
  }

  window.location.reload();
}

/**
 * Registers the root PWA service worker once per page load.
 *
 * The versioned script URL prevents an intermediary cache from returning an
 * earlier worker after a deployment. `updateViaCache: "none"` also instructs
 * compliant browsers to bypass HTTP cache entries while checking worker updates.
 * An active client reloads once when a different worker takes control, after the
 * worker has cleared its own versioned `bis-*` caches. Initial installation never
 * reloads the page.
 */
export function registerBISServiceWorker(): void {
  if (!canUseServiceWorker()) return;

  const hadControllerAtRegistration =
    navigator.serviceWorker.controller !== null;
  let deploymentUpdateObserved = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadControllerAtRegistration || !deploymentUpdateObserved) return;
    reloadForActivatedVersion(BIS_BUILD_VERSION);
  });

  const register = () => {
    const scriptUrl = `/sw.js?build=${encodeURIComponent(BIS_BUILD_VERSION)}`;
    void navigator.serviceWorker
      .register(scriptUrl, {
        scope: "/",
        updateViaCache: "none",
      })
      .then(registration => {
        const observeInstallingWorker = () => {
          deploymentUpdateObserved = hadControllerAtRegistration;
        };

        registration.addEventListener("updatefound", observeInstallingWorker);
        if (registration.waiting) {
          deploymentUpdateObserved = hadControllerAtRegistration;
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        // Fetch the versioned worker URL without trusting a browser's stale
        // HTTP-cache entry. Failure is non-fatal because offline capability is
        // progressive enhancement, not an authentication or authorization path.
        void registration.update().catch(() => undefined);
      })
      .catch(() => {
        // Offline capability is optional. Do not expose runtime details or PII.
      });
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
