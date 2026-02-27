import React, { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getLastDrinkEvent } from '../../services/database';

// Lazy reference — resolved once on first use so expo-notifications is never
// in the static module graph that Expo Router evaluates at route-discovery time.
let notifService: typeof import('../../services/notifications') | null = null;
async function getNotifService() {
  if (!notifService) {
    notifService = await import('../../services/notifications');
  }
  return notifService;
}

const STORAGE_KEY_REMINDERS = '@smart_bottle_reminders';
const STORAGE_KEY_RECURRING = '@smart_bottle_recurring';
const STORAGE_KEY_SMART = '@smart_bottle_smart_minutes';

interface SavedReminder {
  id: string;
  hour: number;
  minute: number;
  label: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export default function NotificationsTab() {
  const isDark = useColorScheme() === 'dark';
  const bg = isDark ? '#121212' : '#F2F7FF';
  const card = isDark ? '#1E1E2E' : '#FFFFFF';
  const text = isDark ? '#ECEDEE' : '#11181C';
  const sub = isDark ? '#9BA1A6' : '#687076';

  const [reminders, setReminders] = useState<SavedReminder[]>([]);
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurringMinutes, setRecurringMinutes] = useState('60');
  const [smartMinutes, setSmartMinutes] = useState('30');
  const [lastDrinkText, setLastDrinkText] = useState<string>('No drinks logged yet');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newTime, setNewTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const [storedReminders, storedRecurring, storedSmart, lastEvent] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_REMINDERS),
        AsyncStorage.getItem(STORAGE_KEY_RECURRING),
        AsyncStorage.getItem(STORAGE_KEY_SMART),
        getLastDrinkEvent(),
      ]);
      if (storedReminders) setReminders(JSON.parse(storedReminders));
      if (storedRecurring) {
        const parsed = JSON.parse(storedRecurring);
        setRecurringEnabled(parsed.enabled ?? false);
        setRecurringMinutes(String(parsed.minutes ?? 60));
      }
      if (storedSmart) setSmartMinutes(storedSmart);
      if (lastEvent) {
        const d = new Date(lastEvent.timestamp);
        const elapsed = Math.round((Date.now() - lastEvent.timestamp) / 60000);
        setLastDrinkText(
          `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (${elapsed} min ago)`
        );
      }
    } catch (e) {
      console.error('Failed to load notification settings', e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getNotifService().then(({ requestNotificationPermissions }) =>
        requestNotificationPermissions()
      );
      loadSettings();
    }, [loadSettings])
  );

  // ─── Recurring reminder ──────────────────────────────────────────────────────

  const handleRecurringToggle = async (val: boolean) => {
    setRecurringEnabled(val);
    const mins = parseInt(recurringMinutes, 10) || 60;
    await AsyncStorage.setItem(
      STORAGE_KEY_RECURRING,
      JSON.stringify({ enabled: val, minutes: mins })
    );
    const svc = await getNotifService();
    if (val) {
      await svc.scheduleRecurringReminder(mins);
    } else {
      await svc.cancelRecurringReminder();
    }
  };

  const handleRecurringSave = async () => {
    const mins = parseInt(recurringMinutes, 10);
    if (isNaN(mins) || mins < 1) {
      Alert.alert('Invalid interval', 'Please enter a number of minutes greater than 0.');
      return;
    }
    await AsyncStorage.setItem(
      STORAGE_KEY_RECURRING,
      JSON.stringify({ enabled: recurringEnabled, minutes: mins })
    );
    if (recurringEnabled) {
      const svc = await getNotifService();
      await svc.scheduleRecurringReminder(mins);
      Alert.alert('Saved', `Reminder set every ${mins} minutes.`);
    }
  };

  // ─── Smart reminder ──────────────────────────────────────────────────────────

  const handleSmartCheck = async () => {
    const mins = parseInt(smartMinutes, 10);
    if (isNaN(mins) || mins < 1) {
      Alert.alert('Invalid threshold', 'Please enter a number of minutes greater than 0.');
      return;
    }
    await AsyncStorage.setItem(STORAGE_KEY_SMART, String(mins));
    const svc = await getNotifService();
    const fired = await svc.checkAndNotifyIfNeeded(mins);
    if (!fired) {
      Alert.alert('All Good!', `You have had water within the last ${mins} minutes.`);
    }
  };

  // ─── Add time-based reminder ─────────────────────────────────────────────────

  const handleAddReminder = async () => {
    const hour = newTime.getHours();
    const minute = newTime.getMinutes();
    const label = newLabel.trim() || 'Drink water!';
    try {
      const svc = await getNotifService();
      const id = await svc.scheduleTimeReminder(hour, minute, label);
      const reminder: SavedReminder = { id, hour, minute, label };
      const updated = [...reminders, reminder];
      setReminders(updated);
      await AsyncStorage.setItem(STORAGE_KEY_REMINDERS, JSON.stringify(updated));
      setShowAddModal(false);
      setNewLabel('');
      Alert.alert('Reminder Added', `Daily reminder set for ${pad(hour)}:${pad(minute)}.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not schedule reminder');
    }
  };

  const handleDeleteReminder = (reminder: SavedReminder) => {
    Alert.alert(
      'Delete Reminder',
      `Remove the ${pad(reminder.hour)}:${pad(reminder.minute)} reminder?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const svc = await getNotifService();
            await svc.cancelTimeReminder(reminder.id);
            const updated = reminders.filter((r) => r.id !== reminder.id);
            setReminders(updated);
            await AsyncStorage.setItem(STORAGE_KEY_REMINDERS, JSON.stringify(updated));
          },
        },
      ]
    );
  };

  const handleClearAll = () => {
    Alert.alert('Clear All Reminders', 'Cancel all scheduled notifications?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All',
        style: 'destructive',
        onPress: async () => {
          const svc = await getNotifService();
          await svc.cancelAllReminders();
          setReminders([]);
          setRecurringEnabled(false);
          await AsyncStorage.multiRemove([STORAGE_KEY_REMINDERS, STORAGE_KEY_RECURRING]);
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: text }]}>Reminders</Text>
        {reminders.length > 0 && (
          <TouchableOpacity onPress={handleClearAll}>
            <Text style={{ color: '#FF3B30', fontSize: 14, fontWeight: '600' }}>Clear All</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Last drink */}
        <View style={[styles.card, { backgroundColor: card }]}>
          <Ionicons name="water" size={22} color="#007AFF" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.cardLabel, { color: sub }]}>Last drink recorded</Text>
            <Text style={[styles.cardValue, { color: text }]}>{lastDrinkText}</Text>
          </View>
        </View>

        {/* Recurring reminder */}
        <View style={[styles.section, { backgroundColor: card }]}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: text }]}>Recurring Reminder</Text>
              <Text style={[styles.sectionSub, { color: sub }]}>Alert every N minutes</Text>
            </View>
            <Switch
              value={recurringEnabled}
              onValueChange={handleRecurringToggle}
              trackColor={{ false: '#767577', true: '#007AFF' }}
            />
          </View>
          <View style={styles.rowInput}>
            <Text style={[styles.inputLabel, { color: sub }]}>Interval (min)</Text>
            <TextInput
              style={[styles.smallInput, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
              value={recurringMinutes}
              onChangeText={setRecurringMinutes}
              keyboardType="numeric"
              maxLength={4}
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleRecurringSave}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Smart reminder */}
        <View style={[styles.section, { backgroundColor: card }]}>
          <Text style={[styles.sectionTitle, { color: text }]}>Smart Check</Text>
          <Text style={[styles.sectionSub, { color: sub }]}>
            Notify me if I haven't drunk water in:
          </Text>
          <View style={styles.rowInput}>
            <TextInput
              style={[styles.smallInput, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
              value={smartMinutes}
              onChangeText={setSmartMinutes}
              keyboardType="numeric"
              maxLength={4}
            />
            <Text style={[styles.inputLabel, { color: sub }]}>minutes</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleSmartCheck}>
              <Text style={styles.saveBtnText}>Check Now</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Daily reminders */}
        <View style={[styles.section, { backgroundColor: card }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: text }]}>Daily Reminders</Text>
            <TouchableOpacity style={styles.addButton} onPress={() => setShowAddModal(true)}>
              <Ionicons name="add" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          {reminders.length === 0 ? (
            <Text style={[styles.emptyText, { color: sub }]}>
              No daily reminders. Tap + to add one.
            </Text>
          ) : (
            reminders.map((r) => (
              <View
                key={r.id}
                style={[
                  styles.reminderRow,
                  { borderBottomColor: isDark ? '#2C2C3E' : '#F0F0F0' },
                ]}
              >
                <Ionicons name="alarm-outline" size={20} color="#007AFF" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.reminderTime, { color: text }]}>
                    {pad(r.hour)}:{pad(r.minute)}
                  </Text>
                  <Text style={[styles.reminderLabel, { color: sub }]}>{r.label}</Text>
                </View>
                <TouchableOpacity onPress={() => handleDeleteReminder(r)}>
                  <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Add reminder modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: card }]}>
            <Text style={[styles.modalTitle, { color: text }]}>Add Daily Reminder</Text>

            <Text style={[styles.inputLabel, { color: sub, marginBottom: 4 }]}>Label</Text>
            <TextInput
              style={[styles.modalInput, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="e.g. Morning hydration"
              placeholderTextColor={sub}
            />

            <Text style={[styles.inputLabel, { color: sub, marginTop: 12, marginBottom: 4 }]}>
              Time
            </Text>
            {Platform.OS === 'android' && (
              <TouchableOpacity
                style={[styles.timeDisplay, { borderColor: isDark ? '#333' : '#DDD' }]}
                onPress={() => setShowTimePicker(true)}
              >
                <Text
                  style={{ color: text, fontSize: 28, fontWeight: '700', textAlign: 'center' }}
                >
                  {pad(newTime.getHours())}:{pad(newTime.getMinutes())}
                </Text>
              </TouchableOpacity>
            )}

            {(showTimePicker || Platform.OS === 'ios') && (
              <DateTimePicker
                value={newTime}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_: DateTimePickerEvent, date?: Date) => {
                  setShowTimePicker(false);
                  if (date) setNewTime(date);
                }}
              />
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#E5EEF8' }]}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={{ color: '#007AFF', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#007AFF' }]}
                onPress={handleAddReminder}
              >
                <Text style={{ color: '#FFF', fontWeight: '600' }}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

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
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardLabel: { fontSize: 12 },
  cardValue: { fontSize: 15, fontWeight: '600', marginTop: 2 },
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  sectionSub: { fontSize: 13, marginTop: 2 },
  rowInput: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  inputLabel: { fontSize: 13 },
  smallInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 72,
    fontSize: 15,
    textAlign: 'center',
  },
  saveBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  addButton: {
    backgroundColor: '#007AFF',
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  reminderTime: { fontSize: 17, fontWeight: '700' },
  reminderLabel: { fontSize: 13, marginTop: 2 },
  emptyText: { fontSize: 14, paddingVertical: 12 },
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
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 16 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  timeDisplay: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
});
