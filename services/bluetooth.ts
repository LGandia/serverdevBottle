/**
 * Classic Bluetooth SPP service for HC-05 communication.
 *
 * Packet format sent by the Arduino:
 *   START_BYTE  TIMESTAMP(4B LE uint32)  VOLUME_ML(2B LE uint16)  CHECKSUM(1B)  END_BYTE
 *   0xAA        bytes 1-4                bytes 5-6                byte 7        0x55
 *
 * Total: 9 bytes per packet.
 * CHECKSUM = XOR of bytes 1-6.
 *
 * The service also accepts a simple newline-terminated ASCII fallback:
 *   "DRINK,<unix_ts>,<volume_ml>\n"
 *
 * Commands sent TO the Arduino:
 *   "CALIBRATE\n"  — triggers ultrasonic sensor calibration; Arduino stores
 *                    current distance as the full-bottle baseline and replies:
 *                    "CAL_OK,<raw_mm>\n"  on success
 *                    "CAL_FAIL\n"         on failure
 */

import RNBluetoothClassic, {
  BluetoothDevice,
  BluetoothDeviceReadEvent,
} from 'react-native-bluetooth-classic';
import { insertDrinkEvent, dateStrFromTimestamp } from './database';

export interface ParsedDrinkPacket {
  timestamp: number; // Unix epoch ms
  volume_ml: number;
}

export interface CalibrationResult {
  success: boolean;
  raw_mm: number | null; // ultrasonic reading stored as baseline, null on failure
}

// ─── Packet Parser ────────────────────────────────────────────────────────────

const START_BYTE = 0xaa;
const END_BYTE = 0x55;
const BINARY_PACKET_LEN = 9;

/** Parses a binary packet buffer. Returns null if invalid. */
function parseBinaryPacket(buf: Uint8Array): ParsedDrinkPacket | null {
  if (buf.length < BINARY_PACKET_LEN) return null;
  if (buf[0] !== START_BYTE || buf[BINARY_PACKET_LEN - 1] !== END_BYTE) return null;

  // Timestamp: 4 bytes little-endian uint32, bytes 1-4
  const ts =
    buf[1] | (buf[2] << 8) | (buf[3] << 16) | (buf[4] << 24);

  // Volume: 2 bytes little-endian uint16, bytes 5-6
  const vol = buf[5] | (buf[6] << 8);

  // Checksum: XOR of bytes 1-6
  let xor = 0;
  for (let i = 1; i <= 6; i++) xor ^= buf[i];
  if (xor !== buf[7]) return null;

  return {
    timestamp: ts * 1000, // Arduino sends seconds; convert to ms
    volume_ml: vol,
  };
}

/** Parses an ASCII fallback line: "DRINK,<ts_sec>,<vol_ml>" */
function parseAsciiPacket(line: string): ParsedDrinkPacket | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('DRINK,')) return null;
  const parts = trimmed.split(',');
  if (parts.length < 3) return null;
  const ts = parseInt(parts[1], 10);
  const vol = parseFloat(parts[2]);
  if (isNaN(ts) || isNaN(vol) || vol <= 0) return null;
  return { timestamp: ts * 1000, volume_ml: vol };
}

// ─── Connection State ─────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface BluetoothState {
  status: ConnectionStatus;
  deviceName: string | null;
  deviceAddress: string | null;
  lastPacket: ParsedDrinkPacket | null;
  errorMessage: string | null;
}

type Listener = (state: BluetoothState) => void;
type PacketListener = (packet: ParsedDrinkPacket) => void;
type CalibrationListener = (result: CalibrationResult) => void;

let state: BluetoothState = {
  status: 'disconnected',
  deviceName: null,
  deviceAddress: null,
  lastPacket: null,
  errorMessage: null,
};

const listeners: Set<Listener> = new Set();
const packetListeners: Set<PacketListener> = new Set();
const calibrationListeners: Set<CalibrationListener> = new Set();

function setState(partial: Partial<BluetoothState>) {
  state = { ...state, ...partial };
  listeners.forEach((l) => l(state));
}

export function getState(): BluetoothState {
  return state;
}

export function subscribe(listener: Listener): () => void {
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

// ─── Device Management ────────────────────────────────────────────────────────

let activeDevice: BluetoothDevice | null = null;
let readSubscription: { remove: () => void } | null = null;
let asciiBuffer = '';

/** Returns list of paired Bluetooth devices */
export async function getPairedDevices(): Promise<BluetoothDevice[]> {
  try {
    const enabled = await RNBluetoothClassic.isBluetoothEnabled();
    if (!enabled) {
      await RNBluetoothClassic.requestBluetoothEnabled();
    }
    return await RNBluetoothClassic.getBondedDevices();
  } catch (e: any) {
    setState({ errorMessage: e?.message ?? 'Failed to get paired devices' });
    return [];
  }
}

/** Connect to an HC-05 device by address */
export async function connectToDevice(address: string): Promise<boolean> {
  if (activeDevice) {
    await disconnectDevice();
  }

  setState({ status: 'connecting', errorMessage: null });

  try {
    const device = await RNBluetoothClassic.connectToDevice(address);
    activeDevice = device;
    setState({
      status: 'connected',
      deviceName: device.name ?? address,
      deviceAddress: address,
    });

    // Subscribe to incoming data
    readSubscription = device.onDataReceived((event: BluetoothDeviceReadEvent) => {
      handleIncomingData(event.data);
    });

    return true;
  } catch (e: any) {
    setState({
      status: 'error',
      errorMessage: e?.message ?? 'Connection failed',
    });
    return false;
  }
}

export async function disconnectDevice(): Promise<void> {
  readSubscription?.remove();
  readSubscription = null;

  if (activeDevice) {
    try {
      await activeDevice.disconnect();
    } catch (_) {
      // ignore disconnect errors
    }
    activeDevice = null;
  }

  setState({
    status: 'disconnected',
    deviceName: null,
    deviceAddress: null,
  });
}

// ─── Commands (app → Arduino) ─────────────────────────────────────────────────

/**
 * Send a raw newline-terminated string command to the connected device.
 * Throws if not connected.
 */
export async function sendCommand(cmd: string): Promise<void> {
  if (!activeDevice) throw new Error('Not connected to any device');
  await activeDevice.write(cmd.endsWith('\n') ? cmd : cmd + '\n');
}

/**
 * Send "CALIBRATE\n" to the Arduino.
 * The Arduino should respond with "CAL_OK,<mm>\n" or "CAL_FAIL\n".
 * Returns a Promise that resolves with the CalibrationResult once the Arduino
 * replies, or rejects after a 10-second timeout.
 */
export function sendCalibrate(): Promise<CalibrationResult> {
  return new Promise(async (resolve, reject) => {
    if (!activeDevice) {
      reject(new Error('Not connected to any device'));
      return;
    }

    const timeout = setTimeout(() => {
      unsub();
      reject(new Error('Calibration timed out — no response from device'));
    }, 10000);

    // One-shot listener that resolves/rejects on CAL_OK / CAL_FAIL
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

// ─── Data Handling ────────────────────────────────────────────────────────────

function handleIncomingData(raw: string) {
  // react-native-bluetooth-classic delivers data as base64 or plain string
  // depending on device configuration. Attempt binary first, then ASCII.

  // Try ASCII line-based protocol
  asciiBuffer += raw;
  const lines = asciiBuffer.split('\n');
  asciiBuffer = lines.pop() ?? '';

  for (const line of lines) {
    // ── Calibration responses ──────────────────────────────────────────────
    const trimmed = line.trim();
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

    // ── Drink packets ──────────────────────────────────────────────────────
    const asciiPacket = parseAsciiPacket(line);
    if (asciiPacket) {
      handlePacket(asciiPacket);
      continue;
    }

    // Try to decode as binary via base64
    try {
      const bytes = Uint8Array.from(atob(line.trim()), (c) => c.charCodeAt(0));
      for (let i = 0; i <= bytes.length - BINARY_PACKET_LEN; i++) {
        if (bytes[i] === START_BYTE) {
          const slice = bytes.slice(i, i + BINARY_PACKET_LEN);
          const binPacket = parseBinaryPacket(slice);
          if (binPacket) {
            handlePacket(binPacket);
          }
        }
      }
    } catch (_) {
      // Not base64 – ignore
    }
  }
}

async function handlePacket(packet: ParsedDrinkPacket) {
  setState({ lastPacket: packet });
  packetListeners.forEach((l) => l(packet));

  // Persist to local database
  try {
    await insertDrinkEvent({
      timestamp: packet.timestamp,
      volume_ml: packet.volume_ml,
      date_str: dateStrFromTimestamp(packet.timestamp),
    });
  } catch (e) {
    console.error('[BT] Failed to save drink event:', e);
  }
}
