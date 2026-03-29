/**
 * Engine Configuration — Tunable Parameters
 * Derived from LuxAlgo, JOAT, ProjectSyndicate Pine Scripts.
 * Calibrated for 5M/15M intraday scalping.
 */

export const OB_DISP_MULT = 1.2;
export const OB_VOL_MULT = 1.2;
export const OB_STRENGTH_DISP_W = 0.6;
export const OB_STRENGTH_VOL_W = 0.4;
export const OB_MAX_DISP_ATR = 3.0;
export const OB_MAX_VOL_RATIO = 2.0;
export const OB_ENABLE_BREAKERS = true;

export const FVG_MIN_ATR = 0.3;

export const EQH_TOLERANCE = 0.15;
export const EQH_MIN_TOUCHES = 2;

// Macro Structure
export const MACRO_LOOKBACK = 500;
export const SWING_LOOKBACK_MIN = 3;
export const SWING_LOOKBACK_MACRO = 15;
export const TREND_MIN_POINTS = 3;
export const TREND_TOLERANCE_ATR = 0.2;
