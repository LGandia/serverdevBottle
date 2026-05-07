/**
 * Bottle configuration service.
 *
 * Owns all ML_PER_MM calculation logic so it lives in one place.
 *
 * Two configuration modes:
 *
 *  'capacity'   — user knows the bottle's total capacity in ml.
 *                 height_mm is derived from sensor calibration readings
 *                 (d_empty − d_full), or from a manually entered height if
 *                 calibration hasn't been done.
 *                 ML_PER_MM = capacity_ml / height_mm
 *
 *  'dimensions' — user measures the bottle physically.
 *                 ML_PER_MM = π × radius_mm² / 1000
 *                 (cylindrical bottle formula)
 *
 * The computed ml_per_mm value is cached in the database so the Bluetooth
 * service can read it cheaply on every DRINK packet without re-computing.
 */

export type BottleInputMode = 'capacity' | 'dimensions';

export interface BottleConfig {
  mode: BottleInputMode;
  /** Option A — total liquid capacity of the bottle */
  capacity_ml: number;
  /** Used by dimensions mode; also fallback height for capacity mode when
   *  sensor calibration hasn't been done */
  height_cm: number;
  /** Option B — internal diameter of the bottle in cm */
  diameter_cm: number;
  /** Sensor reading when bottle is full (from CALIBRATE command) */
  cal_full_mm: number;
  /** Sensor reading when bottle is empty (from CALIBRATE_EMPTY command) */
  cal_empty_mm: number;
  /** Cached result — recomputed and stored whenever config is saved */
  ml_per_mm: number;
}

// ─── Core calculation ─────────────────────────────────────────────────────────

/**
 * Computes ml_per_mm from the supplied bottle configuration.
 * Returns 0 if there is not enough data to produce a valid value.
 */
export function calculateMlPerMm(config: Pick<BottleConfig,
  'mode' | 'capacity_ml' | 'height_cm' | 'diameter_cm' |
  'cal_full_mm' | 'cal_empty_mm'>
): number {
  if (config.mode === 'capacity') {
    // Derive height from sensor calibration if both readings are available and
    // make physical sense (empty sensor distance > full sensor distance).
    let heightMm: number;

    const calHeightMm = config.cal_empty_mm - config.cal_full_mm;
    if (
      config.cal_full_mm > 0 &&
      config.cal_empty_mm > 0 &&
      calHeightMm > 5  // sanity: must be at least 5 mm of water column
    ) {
      heightMm = calHeightMm;
    } else if (config.height_cm > 0) {
      // Fall back to user-entered height
      heightMm = config.height_cm * 10;
    } else {
      return 0; // not enough information
    }

    if (config.capacity_ml <= 0 || heightMm <= 0) return 0;
    return config.capacity_ml / heightMm;

  } else {
    // Cylindrical formula: volume = π × r² × h  (in mm³) → convert to ml (/1000)
    // ML_PER_MM = π × r² / 1000
    if (config.diameter_cm <= 0) return 0;
    const radiusMm = (config.diameter_cm * 10) / 2;
    return (Math.PI * radiusMm * radiusMm) / 1000;
  }
}

/**
 * Estimates total bottle capacity from physical dimensions.
 * Useful for showing the user what capacity the dimensions imply.
 * Returns 0 if inputs are missing.
 */
export function estimatedCapacityMl(height_cm: number, diameter_cm: number): number {
  if (height_cm <= 0 || diameter_cm <= 0) return 0;
  const radiusMm = (diameter_cm * 10) / 2;
  const heightMm = height_cm * 10;
  return Math.round((Math.PI * radiusMm * radiusMm * heightMm) / 1000);
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface BottleConfigValidation {
  valid: boolean;
  error: string | null;
}

/**
 * Validates a bottle config before saving.
 * Returns { valid: true } or { valid: false, error: '<message>' }.
 */
export function validateBottleConfig(config: Pick<BottleConfig,
  'mode' | 'capacity_ml' | 'height_cm' | 'diameter_cm' |
  'cal_full_mm' | 'cal_empty_mm'>
): BottleConfigValidation {
  if (config.mode === 'capacity') {
    if (config.capacity_ml <= 0) {
      return { valid: false, error: 'Please enter a bottle capacity greater than 0 ml.' };
    }
    // Need either calibration height or manual height
    const calHeightMm = config.cal_empty_mm - config.cal_full_mm;
    const hasCalHeight = config.cal_full_mm > 0 && config.cal_empty_mm > 0 && calHeightMm > 5;
    const hasManualHeight = config.height_cm > 0;
    if (!hasCalHeight && !hasManualHeight) {
      return {
        valid: false,
        error:
          'Please enter the bottle height, or use the calibration buttons to measure it automatically.',
      };
    }
    if (config.capacity_ml > 5000) {
      return { valid: false, error: 'Capacity seems too large (max 5000 ml). Please check your input.' };
    }
  } else {
    // dimensions mode
    if (config.height_cm <= 0) {
      return { valid: false, error: 'Please enter the bottle height.' };
    }
    if (config.diameter_cm <= 0) {
      return { valid: false, error: 'Please enter the bottle diameter.' };
    }
    if (config.height_cm > 60) {
      return { valid: false, error: 'Height seems too large (max 60 cm). Please check your input.' };
    }
    if (config.diameter_cm > 30) {
      return { valid: false, error: 'Diameter seems too large (max 30 cm). Please check your input.' };
    }
  }
  return { valid: true, error: null };
}
