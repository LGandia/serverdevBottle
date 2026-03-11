import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  cancelDiscovery,
  connectToDevice,
  discoverDevices,
  disconnectDevice,
  getPairedDevices,
  getState as getBtState,
  sendCalibrate,
  subscribe as btSubscribe,
  subscribeToPackets,
} from '../../services/bluetooth';
import type { BluetoothState } from '../../services/bluetooth';
import {
  getDailyTotalMl,
  getDrinkEventsByDate,
  getUserProfile,
  todayDateStr,
} from '../../services/database';
import type { DrinkEvent, UserProfileLocal } from '../../services/database';
import { getHydrationStatus } from '../../services/hydration';

type PairedDevice = Awaited<ReturnType<typeof getPairedDevices>>[number];

type CalibrationStatus = 'idle' | 'running' | 'ok' | 'fail';

export default function OverviewTab() {
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();

  const [btState, setBtState] = useState<BluetoothState>(getBtState());
  const [profile, setProfile] = useState<UserProfileLocal | null>(null);
  const [todayMl, setTodayMl] = useState(0);
  const [drinkEvents, setDrinkEvents] = useState<DrinkEvent[]>([]);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<PairedDevice[]>([]);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [deviceTab, setDeviceTab] = useState<'paired' | 'scan'>('paired');
  const [calStatus, setCalStatus] = useState<CalibrationStatus>('idle');
  const [calRawMm, setCalRawMm] = useState<number | null>(null);

  const todayStr = todayDateStr();

  const bg = isDark ? '#121212' : '#F2F7FF';
  const card = isDark ? '#1E1E2E' : '#FFFFFF';
  const text = isDark ? '#ECEDEE' : '#11181C';
  const sub = isDark ? '#9BA1A6' : '#687076';

  useEffect(() => {
    const unsub = btSubscribe((s) => setBtState(s));
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeToPackets(() => refreshData());
    return unsub;
  }, []);

  useEffect(() => {
    // Dynamic import so expo-notifications is never in the static module graph
    // evaluated by Expo Router during route discovery — prevents the SDK 53
    // Expo Go push-token error from blocking the entire tab tree from mounting.
    import('../../services/notifications').then(({ requestNotificationPermissions }) => {
      requestNotificationPermissions();
    });
  }, []);

  const refreshData = useCallback(async () => {
    const [p, total, events] = await Promise.all([
      getUserProfile(),
      getDailyTotalMl(todayStr),
      getDrinkEventsByDate(todayStr),
    ]);
    setProfile(p);
    setTodayMl(total);
    setDrinkEvents(events.reverse());
  }, [todayStr]);

  useFocusEffect(
    useCallback(() => {
      refreshData();
    }, [refreshData])
  );

  const goal = profile?.daily_goal_ml ?? 2000;
  const status = getHydrationStatus(todayMl, goal);

  // ─── Bluetooth ───────────────────────────────────────────────────────────────

  const handleOpenDeviceModal = async () => {
    setDeviceTab('paired');
    setDiscoveredDevices([]);
    setScanLoading(true);
    setShowDeviceModal(true);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out fetching paired devices')), 8000)
      );
      const devices = await Promise.race([getPairedDevices(), timeout]);
      setPairedDevices(devices);
    } catch (e: any) {
      Alert.alert('Bluetooth Error', e?.message ?? 'Failed to get paired devices');
    } finally {
      setScanLoading(false);
    }
  };

  const handleScan = async () => {
    setDeviceTab('scan');
    setDiscoveredDevices([]);
    setScanLoading(true);
    try {
      const devices = await discoverDevices();
      setDiscoveredDevices(devices);
    } catch (e: any) {
      Alert.alert('Scan Error', e?.message ?? 'Failed to discover devices');
    } finally {
      setScanLoading(false);
    }
  };

  const handleCloseDeviceModal = () => {
    cancelDiscovery();
    setShowDeviceModal(false);
  };

  const handleConnect = async (device: PairedDevice) => {
    setShowDeviceModal(false);
    const ok = await connectToDevice(device.address);
    if (!ok) {
      Alert.alert('Connection Failed', btState.errorMessage ?? 'Could not connect to device');
    }
  };

  const handleDisconnect = () => {
    Alert.alert('Disconnect', 'Disconnect from the smart bottle?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: disconnectDevice },
    ]);
  };

  // ─── Calibration ─────────────────────────────────────────────────────────────

  const handleCalibrate = async () => {
    if (btState.status !== 'connected') {
      Alert.alert('Not Connected', 'Connect to your smart bottle first.');
      return;
    }
    Alert.alert(
      'Calibrate Sensor',
      'Fill the bottle to its maximum level, then tap Calibrate. The Arduino will record the current ultrasonic reading as the full-bottle baseline.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Calibrate',
          onPress: async () => {
            setCalStatus('running');
            setCalRawMm(null);
            try {
              const result = await sendCalibrate();
              if (result.success) {
                setCalStatus('ok');
                setCalRawMm(result.raw_mm);
                // Auto-reset indicator after 6 seconds
                setTimeout(() => setCalStatus('idle'), 6000);
              } else {
                setCalStatus('fail');
                setTimeout(() => setCalStatus('idle'), 4000);
                Alert.alert('Calibration Failed', 'The sensor did not respond correctly. Ensure the bottle is full and try again.');
              }
            } catch (e: any) {
              setCalStatus('fail');
              setTimeout(() => setCalStatus('idle'), 4000);
              Alert.alert('Calibration Error', e?.message ?? 'Unknown error');
            }
          },
        },
      ]
    );
  };

  // ─── Derived UI values ────────────────────────────────────────────────────────

  const btStatusColor =
    btState.status === 'connected'
      ? '#34C759'
      : btState.status === 'connecting'
      ? '#FF9500'
      : btState.status === 'error'
      ? '#FF3B30'
      : sub;

  const btIcon =
    btState.status === 'connected'
      ? 'bluetooth'
      : btState.status === 'connecting'
      ? 'sync'
      : 'bluetooth-outline';

  const calColor =
    calStatus === 'ok' ? '#34C759' : calStatus === 'fail' ? '#FF3B30' : '#FF9500';

  const calLabel =
    calStatus === 'running'
      ? 'Calibrating…'
      : calStatus === 'ok'
      ? `Calibrated${calRawMm != null ? ` (${calRawMm} mm)` : ''}`
      : calStatus === 'fail'
      ? 'Calibration failed'
      : 'Calibrate Sensor';

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: text }]}>Smart Bottle</Text>
        <TouchableOpacity
          style={[styles.btButton, { backgroundColor: card }]}
          onPress={btState.status === 'connected' ? handleDisconnect : handleOpenDeviceModal}
        >
          <Ionicons name={btIcon as any} size={20} color={btStatusColor} />
          <Text style={[styles.btLabel, { color: btStatusColor }]}>
            {btState.status === 'connected'
              ? btState.deviceName ?? 'Connected'
              : btState.status === 'connecting'
              ? 'Connecting…'
              : 'Connect Bottle'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Date */}
        <Text style={[styles.dateLabel, { color: sub }]}>
          {new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
        </Text>

        {/* Circular Progress */}
        <View style={styles.progressContainer}>
          <View style={styles.svgWrapper}>
            <View
              style={[
                styles.ringBg,
                { borderColor: isDark ? '#2C2C3E' : '#E5EEF8', borderWidth: 12 },
              ]}
            />
            <View
              style={[
                styles.ringFill,
                {
                  borderColor: status.color,
                  borderWidth: 12,
                  borderRightColor: 'transparent',
                  borderBottomColor: status.percentage > 75 ? status.color : 'transparent',
                  borderLeftColor: status.percentage > 50 ? status.color : 'transparent',
                  transform: [{ rotate: `${(status.percentage / 100) * 360}deg` }],
                },
              ]}
            />
            <View style={styles.ringInner}>
              <Text style={[styles.progressMl, { color: text }]}>
                {todayMl >= 1000 ? `${(todayMl / 1000).toFixed(2)}L` : `${Math.round(todayMl)}ml`}
              </Text>
              <Text style={[styles.progressGoal, { color: sub }]}>
                of {goal >= 1000 ? `${(goal / 1000).toFixed(1)}L` : `${goal}ml`}
              </Text>
              <Text style={[styles.progressPct, { color: status.color }]}>
                {status.percentage}%
              </Text>
            </View>
          </View>
          <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
        </View>

        {/* Quick stats row */}
        <View style={styles.statsRow}>
          <StatCard
            card={card} text={text} sub={sub}
            icon="water-outline"
            label="Remaining"
            value={
              Math.max(0, goal - todayMl) >= 1000
                ? `${(Math.max(0, goal - todayMl) / 1000).toFixed(2)}L`
                : `${Math.round(Math.max(0, goal - todayMl))}ml`
            }
          />
          <StatCard
            card={card} text={text} sub={sub}
            icon="list-outline"
            label="Drinks Today"
            value={String(drinkEvents.length)}
          />
          <StatCard
            card={card} text={text} sub={sub}
            icon="flag-outline"
            label="Daily Goal"
            value={goal >= 1000 ? `${(goal / 1000).toFixed(1)}L` : `${goal}ml`}
          />
        </View>

        {/* Calibration card */}
        <View style={[styles.calCard, { backgroundColor: card }]}>
          <View style={styles.calRow}>
            <View style={styles.calInfo}>
              <Ionicons name="options-outline" size={22} color="#FF9500" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={[styles.calTitle, { color: text }]}>Sensor Calibration</Text>
                <Text style={[styles.calSubtitle, { color: sub }]}>
                  Fill bottle to max, then calibrate so the ultrasonic sensor learns the full level.
                </Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            style={[
              styles.calButton,
              {
                backgroundColor:
                  calStatus === 'running'
                    ? isDark ? '#2C2C3E' : '#F0F0F0'
                    : calStatus === 'ok'
                    ? '#34C759'
                    : calStatus === 'fail'
                    ? '#FF3B30'
                    : '#FF9500',
                opacity: btState.status !== 'connected' ? 0.45 : 1,
              },
            ]}
            onPress={handleCalibrate}
            disabled={calStatus === 'running'}
          >
            {calStatus === 'running' ? (
              <ActivityIndicator size="small" color={isDark ? '#FFF' : '#555'} />
            ) : (
              <Ionicons
                name={
                  calStatus === 'ok'
                    ? 'checkmark-circle'
                    : calStatus === 'fail'
                    ? 'close-circle'
                    : 'reload'
                }
                size={18}
                color="#FFF"
              />
            )}
            <Text style={[styles.calButtonText, calStatus === 'running' && { color: sub }]}>
              {calLabel}
            </Text>
          </TouchableOpacity>
          {btState.status !== 'connected' && (
            <Text style={[styles.calHint, { color: sub }]}>
              Connect your bottle to calibrate
            </Text>
          )}
        </View>

        {/* Drink history */}
        <View style={[styles.historyCard, { backgroundColor: card }]}>
          <View style={styles.historyHeader}>
            <Text style={[styles.historyTitle, { color: text }]}>Today's Drinks</Text>
            <TouchableOpacity onPress={() => router.push('/statistics')}>
              <Text style={{ color: '#007AFF', fontSize: 14 }}>See Stats</Text>
            </TouchableOpacity>
          </View>

          {drinkEvents.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="water-outline" size={36} color={sub} />
              <Text style={[styles.emptyText, { color: sub }]}>
                No drinks recorded yet today.
              </Text>
              {btState.status !== 'connected' && (
                <Text style={[styles.emptySubText, { color: sub }]}>
                  Connect your smart bottle to start tracking.
                </Text>
              )}
            </View>
          ) : (
            drinkEvents.slice(0, 10).map((e, i) => (
              <DrinkRow key={e.id ?? i} event={e} isDark={isDark} text={text} sub={sub} />
            ))
          )}
        </View>

        {btState.errorMessage ? (
          <Text style={styles.errorText}>{btState.errorMessage}</Text>
        ) : null}
      </ScrollView>

      {/* Device selector modal */}
      <Modal
        visible={showDeviceModal}
        animationType="slide"
        transparent
        onRequestClose={handleCloseDeviceModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: card }]}>
            <Text style={[styles.modalTitle, { color: text }]}>Select Device</Text>
            <Text style={[styles.modalSub, { color: sub }]}>
              Select your HC-05 smart bottle module
            </Text>

            {/* Paired / Scan tabs */}
            <View style={[styles.tabRow, { backgroundColor: isDark ? '#2C2C3E' : '#F0F0F0' }]}>
              <TouchableOpacity
                style={[styles.tabBtn, deviceTab === 'paired' && styles.tabBtnActive]}
                onPress={() => setDeviceTab('paired')}
              >
                <Text style={[styles.tabBtnText, { color: deviceTab === 'paired' ? '#FFF' : sub }]}>
                  Paired
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, deviceTab === 'scan' && styles.tabBtnActive]}
                onPress={handleScan}
                disabled={scanLoading && deviceTab === 'scan'}
              >
                <Text style={[styles.tabBtnText, { color: deviceTab === 'scan' ? '#FFF' : sub }]}>
                  {scanLoading && deviceTab === 'scan' ? 'Scanning…' : 'Scan'}
                </Text>
              </TouchableOpacity>
            </View>

            {scanLoading ? (
              <ActivityIndicator color="#007AFF" style={{ marginVertical: 20 }} />
            ) : (deviceTab === 'paired' ? pairedDevices : discoveredDevices).length === 0 ? (
              <Text style={[styles.noDevices, { color: sub }]}>
                {deviceTab === 'paired'
                  ? 'No paired devices found. Try the Scan tab or pair your HC-05 in Android Bluetooth settings.'
                  : 'No devices found. Make sure the HC-05 is powered on and in pairing mode.'}
              </Text>
            ) : (
              (deviceTab === 'paired' ? pairedDevices : discoveredDevices).map((d) => (
                <TouchableOpacity
                  key={d.address}
                  style={[styles.deviceRow, { borderColor: isDark ? '#333' : '#EEE' }]}
                  onPress={() => handleConnect(d)}
                >
                  <Ionicons name="bluetooth" size={20} color="#007AFF" />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={[styles.deviceName, { color: text }]}>
                      {d.name ?? 'Unknown Device'}
                    </Text>
                    <Text style={[styles.deviceAddr, { color: sub }]}>{d.address}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={sub} />
                </TouchableOpacity>
              ))
            )}

            <TouchableOpacity
              style={styles.modalClose}
              onPress={handleCloseDeviceModal}
            >
              <Text style={{ color: '#FF3B30', fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  card, text, sub, icon, label, value,
}: {
  card: string; text: string; sub: string;
  icon: string; label: string; value: string;
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: card }]}>
      <Ionicons name={icon as any} size={22} color="#007AFF" />
      <Text style={[styles.statValue, { color: text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: sub }]}>{label}</Text>
    </View>
  );
}

function DrinkRow({
  event, isDark, text, sub,
}: {
  event: DrinkEvent; isDark: boolean; text: string; sub: string;
}) {
  const d = new Date(event.timestamp);
  const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <View
      style={[styles.drinkRow, { borderBottomColor: isDark ? '#2C2C3E' : '#F0F0F0' }]}
    >
      <Ionicons name="water" size={18} color="#007AFF" />
      <Text style={[styles.drinkTime, { color: sub }]}>{timeStr}</Text>
      <Text style={[styles.drinkVol, { color: text }]}>
        {event.volume_ml >= 1000
          ? `${(event.volume_ml / 1000).toFixed(2)} L`
          : `${Math.round(event.volume_ml)} ml`}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const RING_SIZE = 160;

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 24, fontWeight: '700' },
  btButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  btLabel: { fontSize: 13, fontWeight: '600' },
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },
  dateLabel: { fontSize: 14, marginBottom: 20, textAlign: 'center' },
  progressContainer: { alignItems: 'center', marginBottom: 24 },
  svgWrapper: {
    width: RING_SIZE,
    height: RING_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  ringBg: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
  },
  ringFill: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
  },
  ringInner: { alignItems: 'center' },
  progressMl: { fontSize: 26, fontWeight: '700' },
  progressGoal: { fontSize: 13, marginTop: 2 },
  progressPct: { fontSize: 18, fontWeight: '600', marginTop: 4 },
  statusLabel: { marginTop: 10, fontSize: 16, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  statValue: { fontSize: 16, fontWeight: '700' },
  statLabel: { fontSize: 11, textAlign: 'center' },
  // Calibration card
  calCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  calRow: { marginBottom: 12 },
  calInfo: { flexDirection: 'row', alignItems: 'flex-start' },
  calTitle: { fontSize: 15, fontWeight: '700' },
  calSubtitle: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  calButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 12,
    gap: 8,
  },
  calButtonText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  calHint: { fontSize: 11, textAlign: 'center', marginTop: 8 },
  // Drink history
  historyCard: {
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  historyTitle: { fontSize: 17, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { fontSize: 15 },
  emptySubText: { fontSize: 13, textAlign: 'center' },
  drinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  drinkTime: { flex: 1, fontSize: 14 },
  drinkVol: { fontSize: 15, fontWeight: '600' },
  errorText: { color: '#FF3B30', textAlign: 'center', marginTop: 12, fontSize: 13 },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  modalSub: { fontSize: 14, marginBottom: 20 },
  noDevices: { textAlign: 'center', paddingVertical: 24, fontSize: 14 },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  deviceName: { fontSize: 16, fontWeight: '600' },
  deviceAddr: { fontSize: 13, marginTop: 2 },
  modalClose: { marginTop: 24, alignItems: 'center', paddingVertical: 12 },
  tabRow: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabBtnActive: { backgroundColor: '#007AFF' },
  tabBtnText: { fontSize: 14, fontWeight: '600' },
});
