import * as SQLite from 'expo-sqlite';

// ─── Schema version ───────────────────────────────────────────────────────────
// v1 (implicit 0): original schema — drink_events + user_profile (personal data)
// v2: added bottle configuration columns to user_profile
const SCHEMA_VERSION = 2;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DrinkEvent {
  id?: number;
  timestamp: number;  // Unix epoch ms
  volume_ml: number;
  date_str: string;   // 'YYYY-MM-DD'
}

export interface UserProfileLocal {
  id?: number;
  // Personal
  name: string;
  gender: string;
  dob: string;         // 'DD/MM/YYYY'
  height_cm: number;   // user's body height
  weight_kg: number;
  description: string;
  daily_goal_ml: number;
  // Bottle configuration (added in schema v2)
  bottle_input_mode: 'capacity' | 'dimensions';
  bottle_capacity_ml: number;
  bottle_height_cm: number;    // water-column height of the bottle (not user height)
  bottle_diameter_cm: number;
  ml_per_mm: number;           // cached, recomputed on every save
  cal_full_mm: number;         // sensor reading when bottle is full
  cal_empty_mm: number;        // sensor reading when bottle is empty
}

// Subset type used when saving only bottle config fields
export interface BottleConfigUpdate {
  bottle_input_mode: 'capacity' | 'dimensions';
  bottle_capacity_ml: number;
  bottle_height_cm: number;
  bottle_diameter_cm: number;
  ml_per_mm: number;
  cal_full_mm: number;
  cal_empty_mm: number;
}

// ─── DB singleton ─────────────────────────────────────────────────────────────

let db: SQLite.SQLiteDatabase | null = null;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return Promise.resolve(db);
  if (!dbInitPromise) {
    dbInitPromise = SQLite.openDatabaseAsync('smartbottle.db')
      .then(async (database) => {
        await initDb(database);
        db = database;
        return database;
      })
      .catch((err) => {
        dbInitPromise = null;
        throw err;
      });
  }
  return dbInitPromise;
}

// ─── Initialisation & migration ───────────────────────────────────────────────

async function initDb(database: SQLite.SQLiteDatabase): Promise<void> {
  // Create base tables (idempotent — safe to run on every launch)
  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS drink_events (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      volume_ml REAL    NOT NULL,
      date_str  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id            INTEGER PRIMARY KEY,
      name          TEXT    NOT NULL DEFAULT '',
      gender        TEXT    NOT NULL DEFAULT 'Male',
      dob           TEXT    NOT NULL DEFAULT '',
      height_cm     INTEGER NOT NULL DEFAULT 170,
      weight_kg     INTEGER NOT NULL DEFAULT 70,
      description   TEXT    NOT NULL DEFAULT '',
      daily_goal_ml INTEGER NOT NULL DEFAULT 2000
    );
  `);

  // Ensure the single profile row exists
  await database.runAsync(
    `INSERT OR IGNORE INTO user_profile
       (id, name, gender, dob, height_cm, weight_kg, description, daily_goal_ml)
     VALUES (1, '', 'Male', '', 170, 70, '', 2000)`
  );

  // Run any pending migrations
  const versionRow = await database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const currentVersion = versionRow?.user_version ?? 0;
  await runMigrations(database, currentVersion);
}

/**
 * Applies schema migrations sequentially.
 * Each migration block is guarded by the version it upgrades FROM.
 */
async function runMigrations(
  database: SQLite.SQLiteDatabase,
  fromVersion: number
): Promise<void> {
  if (fromVersion >= SCHEMA_VERSION) return;

  // ── Migration to v2: add bottle configuration columns ──────────────────────
  if (fromVersion < 2) {
    const newColumns: string[] = [
      `ALTER TABLE user_profile ADD COLUMN bottle_input_mode TEXT    NOT NULL DEFAULT 'dimensions'`,
      `ALTER TABLE user_profile ADD COLUMN bottle_capacity_ml REAL   NOT NULL DEFAULT 0`,
      `ALTER TABLE user_profile ADD COLUMN bottle_height_cm   REAL   NOT NULL DEFAULT 0`,
      `ALTER TABLE user_profile ADD COLUMN bottle_diameter_cm REAL   NOT NULL DEFAULT 0`,
      `ALTER TABLE user_profile ADD COLUMN ml_per_mm          REAL   NOT NULL DEFAULT 0`,
      `ALTER TABLE user_profile ADD COLUMN cal_full_mm        REAL   NOT NULL DEFAULT 0`,
      `ALTER TABLE user_profile ADD COLUMN cal_empty_mm       REAL   NOT NULL DEFAULT 0`,
    ];
    for (const sql of newColumns) {
      try {
        await database.execAsync(sql);
      } catch (_) {
        // Column already exists on a partially migrated DB — safe to skip
      }
    }
    await database.execAsync(`PRAGMA user_version = 2`);
  }

  // Future migrations go here:
  // if (fromVersion < 3) { ... await database.execAsync('PRAGMA user_version = 3'); }
}

// ─── Drink Events ─────────────────────────────────────────────────────────────

export async function insertDrinkEvent(event: DrinkEvent): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'INSERT INTO drink_events (timestamp, volume_ml, date_str) VALUES (?, ?, ?)',
    event.timestamp,
    event.volume_ml,
    event.date_str
  );
}

export async function getDrinkEventsByDate(dateStr: string): Promise<DrinkEvent[]> {
  const database = await getDb();
  return await database.getAllAsync<DrinkEvent>(
    'SELECT * FROM drink_events WHERE date_str = ? ORDER BY timestamp ASC',
    dateStr
  );
}

export async function getDailyTotalMl(dateStr: string): Promise<number> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(volume_ml), 0) as total FROM drink_events WHERE date_str = ?',
    dateStr
  );
  return row?.total ?? 0;
}

export async function getLastDrinkEvent(): Promise<DrinkEvent | null> {
  const database = await getDb();
  return await database.getFirstAsync<DrinkEvent>(
    'SELECT * FROM drink_events ORDER BY timestamp DESC LIMIT 1'
  );
}

export async function getWeeklyTotals(): Promise<{ date_str: string; total: number }[]> {
  const database = await getDb();
  return await database.getAllAsync<{ date_str: string; total: number }>(
    `SELECT date_str, COALESCE(SUM(volume_ml), 0) as total
     FROM drink_events
     GROUP BY date_str
     ORDER BY date_str DESC
     LIMIT 7`
  );
}

export async function getAllDrinkEvents(): Promise<DrinkEvent[]> {
  const database = await getDb();
  return await database.getAllAsync<DrinkEvent>(
    'SELECT * FROM drink_events ORDER BY timestamp DESC'
  );
}

// ─── User Profile ─────────────────────────────────────────────────────────────

export async function saveUserProfile(
  profile: Omit<UserProfileLocal, 'id' | 'bottle_input_mode' | 'bottle_capacity_ml' |
    'bottle_height_cm' | 'bottle_diameter_cm' | 'ml_per_mm' | 'cal_full_mm' | 'cal_empty_mm'>
): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT OR REPLACE INTO user_profile
       (id, name, gender, dob, height_cm, weight_kg, description, daily_goal_ml)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
    profile.name,
    profile.gender,
    profile.dob,
    profile.height_cm,
    profile.weight_kg,
    profile.description,
    profile.daily_goal_ml
  );
}

export async function getUserProfile(): Promise<UserProfileLocal | null> {
  const database = await getDb();
  return await database.getFirstAsync<UserProfileLocal>(
    'SELECT * FROM user_profile WHERE id = 1'
  );
}

// ─── Bottle Configuration ─────────────────────────────────────────────────────

/**
 * Saves all bottle configuration fields (mode, dimensions, computed ml_per_mm,
 * and calibration readings). Personal profile fields are untouched.
 */
export async function saveBottleConfig(config: BottleConfigUpdate): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE user_profile SET
       bottle_input_mode  = ?,
       bottle_capacity_ml = ?,
       bottle_height_cm   = ?,
       bottle_diameter_cm = ?,
       ml_per_mm          = ?,
       cal_full_mm        = ?,
       cal_empty_mm       = ?
     WHERE id = 1`,
    config.bottle_input_mode,
    config.bottle_capacity_ml,
    config.bottle_height_cm,
    config.bottle_diameter_cm,
    config.ml_per_mm,
    config.cal_full_mm,
    config.cal_empty_mm
  );
}

/**
 * Updates only the full-calibration sensor reading (cal_full_mm).
 * Called from the Overview tab when "Calibrate Sensor" succeeds, so the
 * Bottle Setup screen can use it for height derivation without requiring
 * the user to re-calibrate from scratch.
 */
export async function saveCalFullMm(mm: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE user_profile SET cal_full_mm = ? WHERE id = 1',
    mm
  );
}

/**
 * Updates only the empty-calibration sensor reading (cal_empty_mm).
 * Called from the Bottle Setup screen when "Calibrate Empty" succeeds.
 */
export async function saveCalEmptyMm(mm: number): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE user_profile SET cal_empty_mm = ? WHERE id = 1',
    mm
  );
}

/**
 * Returns the cached ml_per_mm value. Used by the Bluetooth service to
 * convert drop_mm → volume_ml on each incoming DRINK packet.
 * Returns 0 if the bottle has not been configured yet.
 */
export async function getMlPerMm(): Promise<number> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ ml_per_mm: number }>(
    'SELECT ml_per_mm FROM user_profile WHERE id = 1'
  );
  return row?.ml_per_mm ?? 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function dateStrFromTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
