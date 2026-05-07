/**
 * Classic Bluetooth SPP service for HC-05 communication.
 *
 * ── Packet formats ────────────────────────────────────────────────────────────
 *
 * NEW firmware (updated Arduino):
 *   "DRINK,<unix_sec>,<drop_mm>\n"
 *   drop_mm is a float with ONE decimal place, e.g. "DRINK,1744580400,12.5"
 *   The app multiplies drop_mm × ml_per_mm to get volume_ml.
 *
 * LEGACY firmware (original Arduino, backward compatible):
 *   "DRINK,<unix_sec>,<volume_ml>\n"
 *   volume_ml is an integer, e.g. "DRINK,1744580400,185"
 *   Detected by absence of a decimal point in field[2].
 *
 * Binary packet (supported in parser but not sent by current firmware):
 *   START_BYTE  TIMESTAMP(4B LE uint32)  VOLUME_ML(2B LE uint16)  CHECKSUM(1B)  END_BYTE
 *   0xAA        bytes 1-4                bytes 5-6                byte 7        0x55
 *
 * ── Commands sent TO the Arduino ──────────────────────────────────────────────
 *   "CALIBRATE\n"       → full calibration; Arduino replies "CAL_OK,<mm>\n" or "CAL_FAIL\n"
 *   "CALIBRATE_EMPTY\n" → empty calibration; replies "CAL_EMPTY_OK,<mm>\n" or "CAL_EMPTY_FAIL\n"
 *   "TIME,<unix_sec>\n" → timestamp sync; replies "TIME_OK\n"
 */

import RNBluetoothClassic, {
  BluetoothDevice,
  BluetoothDeviceReadEvent,
} from 'react-native-bluetooth-classic';
import { PermissionsAndroid, Platform } from 'react-native';
import { insertDrinkEvent, dateStrFromTimestamp, getMlPerMm } from './database';

// ─── Permission helper ────────────────────────────────────────────────────────

export async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    const allGranted = Object.values(granted).every(
      (r) => r === PermissionsAndroid.RESULTS.GRANTED
    );
    if (!allGranted) console.warn('[BT] Some permissions denied:', granted);
    return allGranted;
  } catch (e) {
    console.error('[BT] Permission request failed:', e);
    return false;
  }
}

// ─── Packet types ─────────────────────────────────────────────────────────────

export interface ParsedDrinkPacket {
  timestamp: number;          // Unix epoch ms
  volume_ml: number;          // Always populated before reaching listeners/DB
  /** Raw mm drop as sent by new firmware. null for legacy packets. */
  drop_mm: number | null;
}

export interface CalibrationResult {
  success: boolean;
  raw_mm: number | null;
}

export interface CalibrationEmptyResult {
  success: boolean;
  raw_mm: number | null;
}

// ─── Binary packet parser (legacy support) ────────────────────────────────────

const START_BYTE = 0xaa;
const END_BYTE   = 0x55;
const BINARY_PACKET_LEN = 9;

function parseBinaryPacket(buf: Uint8Array): ParsedDrinkPacket | null {
  if (buf.length < BINARY_PACKET_LEN) return null;
  if (buf[0] !== START_BYTE || buf[BINARY_PACKET_LEN - 1] !== END_BYTE) return null;

  const ts  = buf[1] | (buf[2] << 8) | (buf[3] << 16) | (buf[4] << 24);
  const vol = buf[5] | (buf[6] << 8);

  let xor = 0;
  for (let i = 1; i <= 6; i++) xor ^= buf[i];
  if (xor !== buf[7]) return null;

  return { timestamp: ts * 1000, volume_ml: vol, drop_mm: null };
}

// ─── ASCII packet parser ──────────────────────────────────────────────────────

/**
 * Parses "DRINK,<ts_sec>,<value>" lines.
 *
 * Backward-compatibility rule:
 *   - If field[2] contains a decimal point → new firmware → value is drop_mm.
 *     volume_ml will be computed later by handlePacket using the stored ml_per_mm.
 *   - If field[2] is an integer (no decimal) → legacy firmware → value is volume_ml.
 *
 * This works because the new Arduino firmware always prints drop_mm with one
 * decimal place (e.g. "12.0", "12.5") via println(dropMm, 1), while the old
 * firmware cast volume to int before printing.
 */
function parseAsciiPacket(line: string): Omit<ParsedDrinkPacket, 'volume_ml'> & { volume_ml: number | null } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('DRINK,')) return null;

  const parts = trimmed.split(',');
  if (parts.length < 3) return null;

  const ts       = parseInt(parts[1], 10);
  const rawField = parts[2].trim();
  const value    = parseFloat(rawField);

  if (isNaN(ts) || isNaN(value) || value <= 0) return null;

  const isDropMm = rawField.includes('.');

  return {
    timestamp: ts * 1000,
    volume_ml: isDropMm ? null : value,  // null = needs ml_per_mm conversion
    drop_mm:   isDropMm ? value : null,
  };
}

// ─── Connection state ─────────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface BluetoothState {
  status: ConnectionStatus;
  deviceName: string | null;
  deviceAddress: string | null;
  lastPacket: ParsedDrinkPacket | null;
  errorMessage: string | null;
  /**
   * NEW: Whether the bottle is configured (ml_per_mm > 0).
   * null  = no DRINK packet has arrived yet this session (unknown).
   * true  = last packet was processed successfully.
   * false = last packet was rejected because ml_per_mm = 0.
   * UI uses this to show a persistent warning banner without waiting for
   * another packet to arrive.
   */
  bottleConfigured: boolean | null;
}

type StateListener            = (state: BluetoothState) => void;
type PacketListener           = (packet: ParsedDrinkPacket) => void;
type CalibrationListener      = (result: CalibrationResult) => void;
type CalibrationEmptyListener = (result: CalibrationEmptyResult) => void;
/** Fired when a DRINK packet arrives but ml_per_mm = 0 (bottle not configured). */
type BottleNotConfiguredListener = () => void;

let state: BluetoothState = {
  status: 'disconnected',
  deviceName: null,
  deviceAddress: null,
  lastPacket: null,
  errorMessage: null,
  bottleConfigured: null,  // NEW: unknown until first DRINK packet is received
};

// ─── Not-configured debounce (NEW) ───────────────────────────────────────────
// Prevents the "bottle not configured" alert from firing on every single packet
// when the user hasn't set up their bottle yet. The listener fires once, then
// is silenced for DEBOUNCE_MS. Calling resetBottleNotConfiguredDebounce() (e.g.
// after the user saves a valid bottle config) re-arms it immediately.
const BOTTLE_NOT_CONFIGURED_DEBOUNCE_MS = 30_000; // 30 seconds between alerts
let   lastNotConfiguredFireMs           = 0;

/**
 * NEW: Re-arms the not-configured debounce.
 * Call this after the user successfully saves a bottle configuration so the
 * next incoming DRINK packet is evaluated without waiting 30 seconds.
 */
export function resetBottleNotConfiguredDebounce(): void {
  lastNotConfiguredFireMs = 0;
}

const listeners:                  Set<StateListener>              = new Set();
const packetListeners:            Set<PacketListener>             = new Set();
const calibrationListeners:       Set<CalibrationListener>        = new Set();
const calibrationEmptyListeners:  Set<CalibrationEmptyListener>   = new Set();
const bottleNotConfiguredListeners: Set<BottleNotConfiguredListener> = new Set();

function setState(partial: Partial<BluetoothState>) {
  state = { ...state, ...partial };
  listeners.forEach((l) => l(state));
}

export function getState(): BluetoothState { return state; }

export function subscribe(listener: StateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeToPackets(listener: PacketListener): () => void {
  packetListeners.add(listener);
  return () => packetListeners.delete(listener);
}

export function subscribeToCalibration(listener: CalibrationListener): () => void {
  calibrationListeners.add(listener);
  return () => calibrationListeners.delete(listener);
}

export function subscribeToCalibrationEmpty(listener: CalibrationEmptyListener): () => void {
  calibrationEmptyListeners.add(listener);
  return () => calibrationEmptyListeners.delete(listener);
}

/**
 * Subscribe to be notified when a DRINK packet arrives but the bottle has not
 * been configured yet (ml_per_mm = 0). Use this to prompt the user to open
 * the Bottle Setup screen.
 */
export function subscribeToBottleNotConfigured(listener: BottleNotConfiguredListener): () => void {
  bottleNotConfiguredListeners.add(listener);
  return () => bottleNotConfiguredListeners.delete(listener);
}

// ─── Device management ────────────────────────────────────────────────────────

let activeDevice:    BluetoothDevice | null = null;
let readSubscription: { remove: () => void } | null = null;
let asciiBuffer = '';

export async function getPairedDevices(): Promise<BluetoothDevice[]> {
  try {
    await requestBluetoothPermissions();
    const enabled = await RNBluetoothClassic.isBluetoothEnabled();
    if (!enabled) await RNBluetoothClassic.requestBluetoothEnabled();
    return await RNBluetoothClassic.getBondedDevices();
  } catch (e: any) {
    setState({ errorMessage: e?.message ?? 'Failed to get paired devices' });
    return [];
  }
}

export async function discoverDevices(): Promise<BluetoothDevice[]> {
  try {
    await requestBluetoothPermissions();
    const enabled = await RNBluetoothClassic.isBluetoothEnabled();
    if (!enabled) await RNBluetoothClassic.requestBluetoothEnabled();
    return await RNBluetoothClassic.startDiscovery();
  } catch (e: any) {
    setState({ errorMessage: e?.message ?? 'Device discovery failed' });
    return [];
  }
}

export async function cancelDiscovery(): Promise<void> {
  try { await RNBluetoothClassic.cancelDiscovery(); } catch (_) { /* ignore */ }
}

export async function connectToDevice(address: string): Promise<boolean> {
  if (activeDevice) await disconnectDevice();
  await requestBluetoothPermissions();
  setState({ status: 'connecting', errorMessage: null });

  // HC-05 modules sometimes fail on the first RFCOMM socket attempt.
  // A single retry after a short delay resolves this in most cases.
  const MAX_ATTEMPTS = 2;
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        // Brief pause so the radio can reset before retrying
        await new Promise((r) => setTimeout(r, 600));
      }

      const device = await RNBluetoothClassic.connectToDevice(address);
      activeDevice = device;
      setState({ status: 'connected', deviceName: device.name ?? address, deviceAddress: address });

      readSubscription = device.onDataReceived((event: BluetoothDeviceReadEvent) => {
        handleIncomingData(event.data);
      });

      // Sync Unix time so drink events get correct timestamps
      try {
        await device.write(`TIME,${Math.floor(Date.now() / 1000)}\n`);
      } catch (e) {
        console.warn('[BT] TIME sync failed:', e);
      }

      return true;
    } catch (e: any) {
      lastError = e;
      console.warn(`[BT] Connection attempt ${attempt}/${MAX_ATTEMPTS} failed:`, e?.message);
    }
  }

  setState({ status: 'error', errorMessage: lastError?.message ?? 'Connection failed' });
  return false;
}

export async function disconnectDevice(): Promise<void> {
  readSubscription?.remove();
  readSubscription = null;
  if (activeDevice) {
    try { await activeDevice.disconnect(); } catch (_) { /* ignore */ }
    activeDevice = null;
  }
  setState({ status: 'disconnected', deviceName: null, deviceAddress: null });
}

// ─── Commands (app → Arduino) ─────────────────────────────────────────────────

export async function sendCommand(cmd: string): Promise<void> {
  if (!activeDevice) throw new Error('Not connected to any device');
  await activeDevice.write(cmd.endsWith('\n') ? cmd : cmd + '\n');
}

/**
 * Sends "CALIBRATE\n" and waits for "CAL_OK,<mm>" or "CAL_FAIL".
 * Resolves with CalibrationResult or rejects after 20 s.
 */
export function sendCalibrate(): Promise<CalibrationResult> {
  return new Promise(async (resolve, reject) => {
    if (!activeDevice) { reject(new Error('Not connected')); return; }

    const timeout = setTimeout(() => {
      unsub();
      reject(new Error('Calibration timed out — no response from device'));
    }, 20000);

    const unsub = subscribeToCalibration((result) => {
      clearTimeout(timeout);
      unsub();
      resolve(result);
    });

    try {
      await sendCommand('CALIBRATE');
    } catch (e) {
      clearTimeout(timeout);
      unsub();
      reject(e);
    }
  });
}

/**
 * Sends "CALIBRATE_EMPTY\n" and waits for "CAL_EMPTY_OK,<mm>" or "CAL_EMPTY_FAIL".
 * Resolves with CalibrationEmptyResult or rejects after 20 s.
 */
export function sendCalibrateEmpty(): Promise<CalibrationEmptyResult> {
  return new Promise(async (resolve, reject) => {
    if (!activeDevice) { reject(new Error('Not connected')); return; }

    const timeout = setTimeout(() => {
      unsub();
      reject(new Error('Empty calibration timed out — no response from device'));
    }, 20000);

    const unsub = subscribeToCalibrationEmpty((result) => {
      clearTimeout(timeout);
      unsub();
      resolve(result);
    });

    try {
      await sendCommand('CALIBRATE_EMPTY');
    } catch (e) {
      clearTimeout(timeout);
      unsub();
      reject(e);
    }
  });
}

// ─── Incoming data handler ────────────────────────────────────────────────────

function handleIncomingData(raw: string) {
  asciiBuffer += raw;
  const lines = asciiBuffer.split(/\r\n|\r|\n/);
  asciiBuffer = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();

    // ── Full calibration responses ────────────────────────────────────────
    if (trimmed.startsWith('CAL_OK,')) {
      const mm = parseInt(trimmed.split(',')[1], 10);
      calibrationListeners.forEach((l) =>
        l({ success: true, raw_mm: isNaN(mm) ? null : mm })
      );
      continue;
    }
    if (trimmed === 'CAL_FAIL') {
      calibrationListeners.forEach((l) => l({ success: false, raw_mm: null }));
      continue;
    }

    // ── Empty calibration responses ───────────────────────────────────────
    if (trimmed.startsWith('CAL_EMPTY_OK,')) {
      const mm = parseInt(trimmed.split(',')[1], 10);
      calibrationEmptyListeners.forEach((l) =>
        l({ success: true, raw_mm: isNaN(mm) ? null : mm })
      );
      continue;
    }
    if (trimmed === 'CAL_EMPTY_FAIL') {
      calibrationEmptyListeners.forEach((l) => l({ success: false, raw_mm: null }));
      continue;
    }

    // ── Drink packet (ASCII) ──────────────────────────────────────────────
    const asciiPacket = parseAsciiPacket(line);
    if (asciiPacket) {
      handlePacket(asciiPacket);
      continue;
    }

    // ── Drink packet (binary / base64) ────────────────────────────────────
    try {
      const bytes = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
      for (let i = 0; i <= bytes.length - BINARY_PACKET_LEN; i++) {
        if (bytes[i] === START_BYTE) {
          const binPacket = parseBinaryPacket(bytes.slice(i, i + BINARY_PACKET_LEN));
          if (binPacket) handlePacket(binPacket);
        }
      }
    } catch (_) {
      // Not base64 — ignore
    }
  }
}

/**
 * Finalises a drink packet:
 *  1. If it came from new firmware (drop_mm set, volume_ml null), look up
 *     ml_per_mm from DB and compute volume_ml.
 *  2. MODIFIED: If ml_per_mm = 0 (bottle not configured):
 *       - Update bottleConfigured state to false (UI shows persistent warning)
 *       - Fire bottleNotConfiguredListeners at most once per 30 s (debounce)
 *       - Discard the packet — nothing is written to SQLite
 *  3. MODIFIED: If ml_per_mm > 0, mark bottleConfigured = true in state.
 *  4. Persist to SQLite and notify UI listeners.
 */
async function handlePacket(
  packet: Omit<ParsedDrinkPacket, 'volume_ml'> & { volume_ml: number | null }
) {
  let volumeMl = packet.volume_ml;

  if (volumeMl === null && packet.drop_mm !== null) {
    // New-firmware packet — convert using the user's bottle configuration
    const mlPerMm = await getMlPerMm();

    if (mlPerMm <= 0) {
      // MODIFIED: persist the unconfigured state so the UI can show a banner
      // without waiting for another packet to arrive.
      if (state.bottleConfigured !== false) {
        setState({ bottleConfigured: false });
      }

      // MODIFIED: debounce the alert — fire at most once per 30 s so we don't
      // spam the user with repeated popups on every drink attempt.
      const now = Date.now();
      if (now - lastNotConfiguredFireMs > BOTTLE_NOT_CONFIGURED_DEBOUNCE_MS) {
        lastNotConfiguredFireMs = now;
        console.warn('[BT] DRINK packet received but ml_per_mm is not configured');
        bottleNotConfiguredListeners.forEach((l) => l());
      }

      return; // discard — no SQLite insert
    }

    // MODIFIED: bottle is confirmed working — update state once
    if (state.bottleConfigured !== true) {
      setState({ bottleConfigured: true });
    }

    volumeMl = packet.drop_mm * mlPerMm;
  }

  if (volumeMl === null || volumeMl < 1) return; // guard against noise / nulls

  const finalPacket: ParsedDrinkPacket = { ...packet, volume_ml: volumeMl };

  setState({ lastPacket: finalPacket });
  packetListeners.forEach((l) => l(finalPacket));

  try {
    await insertDrinkEvent({
      timestamp: finalPacket.timestamp,
      volume_ml: finalPacket.volume_ml,
      date_str:  dateStrFromTimestamp(finalPacket.timestamp),
    });
  } catch (e) {
    console.error('[BT] Failed to save drink event:', e);
  }
}
