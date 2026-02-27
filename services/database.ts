import * as SQLite from 'expo-sqlite';

export interface DrinkEvent {
  id?: number;
  timestamp: number; // Unix epoch ms
  volume_ml: number;
  date_str: string; // 'YYYY-MM-DD'
}

export interface UserProfileLocal {
  id?: number;
  name: string;
  gender: string;
  dob: string; // 'DD/MM/YYYY'
  height_cm: number;
  weight_kg: number;
  description: string;
  daily_goal_ml: number;
}

let db: SQLite.SQLiteDatabase | null = null;
// Single in-flight promise so concurrent callers wait for the same init
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
        // Reset so next call retries
        dbInitPromise = null;
        throw err;
      });
  }
  return dbInitPromise;
}

async function initDb(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS drink_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      volume_ml REAL NOT NULL,
      date_str TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT 'Male',
      dob TEXT NOT NULL DEFAULT '',
      height_cm INTEGER NOT NULL DEFAULT 170,
      weight_kg INTEGER NOT NULL DEFAULT 70,
      description TEXT NOT NULL DEFAULT '',
      daily_goal_ml INTEGER NOT NULL DEFAULT 2000
    );
  `);

  // INSERT OR IGNORE so re-runs on an existing DB don't violate the UNIQUE constraint
  await database.runAsync(
    `INSERT OR IGNORE INTO user_profile (id, name, gender, dob, height_cm, weight_kg, description, daily_goal_ml)
     VALUES (1, '', 'Male', '', 170, 70, '', 2000)`
  );
}

// ─── Drink Events ────────────────────────────────────────────────────────────

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

/** Returns last 7 days of daily totals, newest first */
export async function getWeeklyTotals(): Promise<{ date_str: string; total: number }[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ date_str: string; total: number }>(
    `SELECT date_str, COALESCE(SUM(volume_ml), 0) as total
     FROM drink_events
     GROUP BY date_str
     ORDER BY date_str DESC
     LIMIT 7`
  );
  return rows;
}

export async function getAllDrinkEvents(): Promise<DrinkEvent[]> {
  const database = await getDb();
  return await database.getAllAsync<DrinkEvent>(
    'SELECT * FROM drink_events ORDER BY timestamp DESC'
  );
}

// ─── User Profile ─────────────────────────────────────────────────────────────

export async function saveUserProfile(profile: UserProfileLocal): Promise<void> {
  const database = await getDb();
  // INSERT OR REPLACE guarantees the row is written even on a first-time save
  // where the UPDATE would silently match 0 rows.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dateStrFromTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
