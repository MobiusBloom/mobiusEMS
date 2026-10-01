import { lazy, type ComponentType } from "react";

const CHUNK_RETRY_PREFIX = "mobius-chunk-retry:";

// React.lazy uses this constraint to preserve each page's own prop type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    const pageKey = `${CHUNK_RETRY_PREFIX}${window.location.pathname}`;
    try {
      const module = await factory();
      try {
        sessionStorage.removeItem(pageKey);
      } catch { /* Storage access may be disabled by browser policy. */ }

      return module;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isChunkError =
        /dynamically imported module|loading chunk|chunkloaderror|importing a module script|failed to fetch|load failed/i.test(
          message
        );

      if (isChunkError) {
        let alreadyRetried = false;
        try {
          alreadyRetried = sessionStorage.getItem(pageKey) === "true";
          if (!alreadyRetried) {
            sessionStorage.setItem(pageKey, "true");
          }
        } catch {
          // Without persistent state, automatic reload could loop indefinitely.
          alreadyRetried = true;
        }

        if (!alreadyRetried) {
          console.warn("Chunk load error detected after deployment. Forcing fresh asset reload...", error);
          const url = new URL(window.location.href);
          url.searchParams.set("_reload", String(Date.now()));
          window.location.replace(url.toString());
          return new Promise<{ default: T }>(() => {});
        }
      }

      throw error;
    }
  });
}
