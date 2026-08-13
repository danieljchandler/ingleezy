import type { ComponentType } from "react";

type LazyModule<T extends ComponentType<any>> = {
  default: T;
};

const RETRY_KEY = "__lazy_route_retry__";
const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\d]+ failed/i;

export function lazyRetry<T extends ComponentType<any>>(
  importer: () => Promise<LazyModule<T>>,
) {
  return async (): Promise<LazyModule<T>> => {
    try {
      const module = await importer();
      try {
        sessionStorage.removeItem(RETRY_KEY);
      } catch {
        // ignore storage issues
      }
      return module;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (typeof window !== "undefined" && CHUNK_ERROR_PATTERN.test(message)) {
        try {
          const hasRetried = sessionStorage.getItem(RETRY_KEY) === "1";

          if (!hasRetried) {
            sessionStorage.setItem(RETRY_KEY, "1");
            window.location.reload();
            return new Promise<never>(() => {
              // wait for hard reload
            });
          }

          sessionStorage.removeItem(RETRY_KEY);
        } catch {
          window.location.reload();
          return new Promise<never>(() => {
            // wait for hard reload
          });
        }
      }

      throw error;
    }
  };
}