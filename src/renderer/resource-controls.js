export function getLruMapValue(map, key) {
  if (!(map instanceof Map) || !map.has(key)) {
    return undefined;
  }

  const value = map.get(key);
  map.delete(key);
  map.set(key, value);
  return value;
}

export function setLruMapValue(map, key, value, maxEntries) {
  if (!(map instanceof Map)) {
    throw new TypeError("Resource cache must be a Map.");
  }

  const maximumEntries = Math.max(1, Math.trunc(Number(maxEntries) || 1));
  map.delete(key);
  map.set(key, value);
  while (map.size > maximumEntries) {
    map.delete(map.keys().next().value);
  }
  return value;
}

export function trimOldestArrayEntries(array, maxEntries) {
  if (!Array.isArray(array)) {
    throw new TypeError("Resource history must be an array.");
  }

  const maximumEntries = Math.max(0, Math.trunc(Number(maxEntries) || 0));
  if (array.length > maximumEntries) {
    array.splice(0, array.length - maximumEntries);
  }
  return array;
}

export function createIntervalGate(intervalMs, { now = () => Date.now() } = {}) {
  const interval = Math.max(0, Number(intervalMs) || 0);
  let lastRunAt = Number.NEGATIVE_INFINITY;

  return {
    shouldRun({ force = false } = {}) {
      const currentTime = Number(now());
      if (!Number.isFinite(currentTime)) {
        return false;
      }

      if (!force && currentTime >= lastRunAt && currentTime - lastRunAt < interval) {
        return false;
      }

      lastRunAt = currentTime;
      return true;
    },
    reset() {
      lastRunAt = Number.NEGATIVE_INFINITY;
    },
    getLastRunAt() {
      return lastRunAt;
    }
  };
}
