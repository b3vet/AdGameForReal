/**
 * Persistent player data. Deliberately tiny: Milestone 1 only remembered which
 * level is unlocked and Milestone 2 adds the mute flag, but the shape is
 * versioned so the Academy meta layer (decision D7) can extend it without
 * stranding existing saves.
 *
 * A save written before `muted` existed still loads: every field is read
 * defensively and falls back to its default, which is why the key did not need
 * a version bump for this.
 */

const SAVE_KEY = 'arcane-rush.save.v1';

export interface SaveData {
  unlockedLevel: number;
  /** Set from the mute button on the title screen or the HUD. */
  muted: boolean;
}

const DEFAULT_SAVE: SaveData = { unlockedLevel: 1, muted: false };

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

    const fields = parsed as { unlockedLevel?: unknown; muted?: unknown };
    const unlocked = fields.unlockedLevel;
    if (typeof unlocked !== 'number' || !Number.isFinite(unlocked)) return { ...DEFAULT_SAVE };

    return {
      unlockedLevel: Math.max(1, Math.floor(unlocked)),
      muted: fields.muted === true,
    };
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

/** Convenience for the result screen's `Ascend` button. */
export function unlockLevel(level: number): SaveData {
  const current = loadSave();
  if (level <= current.unlockedLevel) return current;

  // Spread rather than a fresh object: unlocking a level must not silently
  // un-mute the game, and the next field added here gets the same protection.
  const next: SaveData = { ...current, unlockedLevel: Math.floor(level) };
  saveSave(next);
  return next;
}

/** Convenience for the mute buttons. */
export function setMuted(muted: boolean): SaveData {
  const next: SaveData = { ...loadSave(), muted };
  saveSave(next);
  return next;
}

export { SAVE_KEY };
