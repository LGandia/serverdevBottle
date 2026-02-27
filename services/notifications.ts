/**
 * Notification service for hydration reminders.
 *
 * Features:
 * - Schedule a recurring reminder every N minutes
 * - Smart reminder: fires if no drink event in the last N minutes
 * - Cancel all scheduled reminders
 * - Permission request helper
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getLastDrinkEvent } from './database';

// Only register the notification handler on native — avoids the Expo Go
// remote-push-token warning that fires when this module is imported on web
// or before a development build is set up.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ─── Simple Recurring Reminder ────────────────────────────────────────────────

const RECURRING_ID_KEY = 'hydration-recurring';

export async function scheduleRecurringReminder(
  intervalMinutes: number
): Promise<void> {
  await cancelRecurringReminder();

  await Notifications.scheduleNotificationAsync({
    identifier: RECURRING_ID_KEY,
    content: {
      title: 'Hydration Reminder',
      body: "Time to drink some water! Stay hydrated.",
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: intervalMinutes * 60,
      repeats: true,
    },
  });
}

export async function cancelRecurringReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(RECURRING_ID_KEY);
}

// ─── Smart Reminder (checks last drink) ──────────────────────────────────────

const SMART_CHECK_ID = 'hydration-smart-check';

/**
 * Schedules a check N minutes from now. When triggered, the app's
 * notification handler fires. Use `checkAndNotifyIfNeeded` in a background
 * task or when the app is foregrounded to send the actual alert.
 */
export async function scheduleSmartReminder(
  thresholdMinutes: number
): Promise<void> {
  await cancelSmartReminder();

  await Notifications.scheduleNotificationAsync({
    identifier: SMART_CHECK_ID,
    content: {
      title: 'Hydration Check',
      body: `You haven't had water in over ${thresholdMinutes} minutes. Drink up!`,
      sound: true,
      data: { type: 'smart', thresholdMinutes },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: thresholdMinutes * 60,
      repeats: true,
    },
  });
}

export async function cancelSmartReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(SMART_CHECK_ID);
}

export async function cancelAllReminders(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// ─── On-demand check ─────────────────────────────────────────────────────────

export async function checkAndNotifyIfNeeded(
  thresholdMinutes: number
): Promise<boolean> {
  const last = await getLastDrinkEvent();
  const now = Date.now();
  const thresholdMs = thresholdMinutes * 60 * 1000;

  const needsReminder =
    !last || now - last.timestamp > thresholdMs;

  if (needsReminder) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Hydration Reminder',
        body: last
          ? `Your last drink was over ${thresholdMinutes} min ago. Time to hydrate!`
          : "You haven't logged any water today. Start drinking!",
        sound: true,
      },
      trigger: null, // fire immediately
    });
  }

  return needsReminder;
}

// ─── Scheduled time-based reminders ──────────────────────────────────────────

export interface ScheduledReminder {
  id: string;
  hour: number;
  minute: number;
  label: string;
}

export async function scheduleTimeReminder(
  hour: number,
  minute: number,
  label: string
): Promise<string> {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Hydration Reminder',
      body: label || 'Time to drink some water!',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
  return id;
}

export async function cancelTimeReminder(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}

export async function getAllScheduledReminders(): Promise<
  Notifications.NotificationRequest[]
> {
  return await Notifications.getAllScheduledNotificationsAsync();
}
