/**
 * Schema for `quality.json`: the frame budget the app holds itself to on a
 * device (docs/28, note 5).
 *
 * A file of its own, like `audio-types.ts`: nothing in here is gameplay, and
 * the sim never reads it.
 */

export interface FramePacing {
  /**
   * Frames drawn per second at most. A display faster than this has its extra
   * refreshes skipped (`src/core/framePacer.ts`); 60 is the budget every number
   * in the performance plans is stated against.
   */
  maxFps: number;
  /**
   * How much earlier than a whole period a callback may arrive and still draw,
   * in milliseconds. Large enough for a 60 Hz display's timestamp jitter, small
   * enough that a 120 Hz display's 8.3 ms gap is always a skip.
   */
  paceSlackMs: number;
}

/**
 * The crowd's small-on-screen copy (`src/render/characters/lod.ts`): how thin
 * it is, and when a unit is drawn from it.
 */
export interface CrowdDetail {
  /** Share of a character's triangles the copy keeps. */
  lodRatio: number;
  /**
   * The most one simplification step may move the surface, as a share of the
   * character's bounding-box diagonal.
   */
  lodMaxError: number;
  /**
   * The most units of one crowd drawn from the full mesh in a frame: the
   * biggest on screen. A squad of this many or fewer is always whole.
   */
  lodWholeBudget: number;
  /**
   * A unit whose bounding sphere is smaller than this on screen, in pixels of
   * the drawing buffer (radius), is drawn from the copy whatever the budget.
   * The sphere is the rest pose's with the cull margin on it, so this is about
   * the unit's full height.
   */
  lodRadiusPixels: number;
  /**
   * Fewer units than this for the copy and the crowd draws them whole
   * instead. A handful of small units saves a few tens of thousands of
   * triangles, and a second draw call per crowd kind is what the smoke's
   * draw budget runs out of first on a busy endless road.
   */
  lodMinSmall: number;
}

/**
 * One rung of the degrade ladder (`src/core/quality.ts`): what the renderer
 * and the physics layer are allowed to spend.
 */
export interface LadderRung {
  /** Ceiling on the backing store's pixels per CSS pixel (D38). */
  pixelRatio: number;
  /**
   * How many crowd units are drawn whole, as a multiple of `lodWholeBudget`;
   * 0 draws every unit from the low-polygon copy.
   */
  crowdDetail: number;
  /** Physics quality: 2 full, 1 fewer ragdolls, 0 none. */
  physics: number;
}

/** The ladder, best rung first, and the rule that walks it. */
export interface LadderTuning {
  rungs: LadderRung[];
  /** A window whose 95th-percentile frame is over this is over budget. */
  frameBudgetMs: number;
  /**
   * Frames longer than the budget and shorter than this are *late*: one or two
   * refreshes missed, which is what a device that is short of time does every
   * few frames. Longer ones are hitches, which a lower rung does not cure.
   */
  lateCeilingMs: number;
  /** A window with more than this share of late frames is over budget too. */
  lateShare: number;
  windowSeconds: number;
  /** Consecutive over-budget windows before the ladder steps. */
  windowsToStep: number;
  /** Seconds after a level start that are not judged at all. */
  settleSeconds: number;
}

export interface QualityTuning {
  frame: FramePacing;
  crowd: CrowdDetail;
  ladder: LadderTuning;
}
