/**
 * Persistent player data. Deliberately tiny: Milestone 1 only remembers which
 * level is unlocked, but the shape is versioned so the Academy meta layer
 * (decision D7) can extend it without stranding existing saves.
 */

const SAVE_KEY = 'arcane-rush.save.v1';

export interface SaveData {
  unlockedLevel: number;
}

const DEFAULT_SAVE: SaveData = { unlockedLevel: 1 };

/**
 * Never throws: private browsing, disabled storage and corrupt JSON all fall
 * back to a fresh save rather than blocking the game from booting.
 */
export function loadSave(): SaveData {
  try {
    const raw = globalThis.localStorage?.getItem(SAVE_KEY);
    if (raw === null || raw === undefined) return { ...DEFAULT_SAVE };

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SAVE };

    const unlocked = (parsed as { unlockedLevel?: unknown }).unlockedLevel;
    if (typeof unlocked !== 'number' || !Number.isFinite(unlocked)) return { ...DEFAULT_SAVE };

    return { unlockedLevel: Math.max(1, Math.floor(unlocked)) };
  } catch {
    return { ...DEFAULT_SAVE };
  }
}

export function saveSave(data: SaveData): void {
  try {
    globalThis.localStorage?.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage being unavailable must not break a run in progress.
  }
}

/** Convenience for the result screen's `Next` button. */
export function unlockLevel(level: number): SaveData {
  const current = loadSave();
  if (level <= current.unlockedLevel) return current;

  const next: SaveData = { unlockedLevel: Math.floor(level) };
  saveSave(next);
  return next;
}

export { SAVE_KEY };
