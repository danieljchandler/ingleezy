type SafeStorageKey = "localStorage" | "sessionStorage";

type StorageShim = Pick<Storage, "clear" | "getItem" | "key" | "removeItem" | "setItem"> & {
  readonly length: number;
};

function createMemoryStorage(): StorageShim {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
  };
}

function storageAvailable(storageKey: SafeStorageKey) {
  if (typeof window === "undefined") return false;

  try {
    const storage = window[storageKey];
    const probe = `__hakiya_storage_probe__${storageKey}`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function installStorageShim(storageKey: SafeStorageKey) {
  if (typeof window === "undefined" || storageAvailable(storageKey)) return;

  try {
    Object.defineProperty(window, storageKey, {
      configurable: true,
      enumerable: true,
      value: createMemoryStorage(),
    });
    console.warn(`[boot] Installed in-memory ${storageKey} shim`);
  } catch (error) {
    console.error(`[boot] Failed to install ${storageKey} shim`, error);
  }
}

installStorageShim("localStorage");
installStorageShim("sessionStorage");