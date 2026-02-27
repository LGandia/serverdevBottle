import React, { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';

import {
  getAllDrinkEvents,
  getDailyTotalMl,
  getUserProfile,
  todayDateStr,
} from '../../services/database';
import type { DrinkEvent } from '../../services/database';
import { getHydrationStatus } from '../../services/hydration';

interface DaySummary {
  date_str: string;
  label: string;
  total: number;
  count: number;
}

function computeStreak(events: DrinkEvent[], goal: number): number {
  if (events.length === 0) return 0;
  const dayMap: Record<string, number> = {};
  events.forEach((e) => {
    dayMap[e.date_str] = (dayMap[e.date_str] ?? 0) + e.volume_ml;
  });
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    if ((dayMap[ds] ?? 0) >= goal) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function MiniCard({
  card,
  sub,
  icon,
  label,
  value,
  color,
}: {
  card: string;
  sub: string;
  icon: string;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={[styles.miniCard, { backgroundColor: card }]}>
      <Ionicons name={icon as any} size={22} color={color} />
      <Text style={[styles.miniValue, { color }]}>{value}</Text>
      <Text style={[styles.miniLabel, { color: sub }]}>{label}</Text>
    </View>
  );
}

function StatRow({
  text,
  sub,
  label,
  value,
}: {
  text: string;
  sub: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, { color: sub }]}>{label}</Text>
      <Text style={[styles.statValue, { color: text }]}>{value}</Text>
    </View>
  );
}

export default function ActivityTab() {
  const isDark = useColorScheme() === 'dark';
  const bg = isDark ? '#121212' : '#F2F7FF';
  const card = isDark ? '#1E1E2E' : '#FFFFFF';
  const text = isDark ? '#ECEDEE' : '#11181C';
  const sub = isDark ? '#9BA1A6' : '#687076';

  const [todayTotal, setTodayTotal] = useState(0);
  const [goal, setGoal] = useState(2000);
  const [recentDays, setRecentDays] = useState<DaySummary[]>([]);
  const [allEvents, setAllEvents] = useState<DrinkEvent[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const todayStr = todayDateStr();
        const [profile, total, events] = await Promise.all([
          getUserProfile(),
          getDailyTotalMl(todayStr),
          getAllDrinkEvents(),
        ]);
        setGoal(profile?.daily_goal_ml ?? 2000);
        setTodayTotal(total);
        setAllEvents(events);

        const dayMap: Record<string, { total: number; count: number }> = {};
        events.forEach((e) => {
          if (!dayMap[e.date_str]) dayMap[e.date_str] = { total: 0, count: 0 };
          dayMap[e.date_str].total += e.volume_ml;
          dayMap[e.date_str].count += 1;
        });

        const summaries: DaySummary[] = Object.entries(dayMap)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .slice(0, 14)
          .map(([ds, v]) => {
            const parts = ds.split('-');
            const d = new Date(
              parseInt(parts[0], 10),
              parseInt(parts[1], 10) - 1,
              parseInt(parts[2], 10)
            );
            return {
              date_str: ds,
              label: d.toLocaleDateString('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              }),
              total: Math.round(v.total),
              count: v.count,
            };
          });
        setRecentDays(summaries);
      })();
    }, [])
  );

  const status = getHydrationStatus(todayTotal, goal);
  const longestStreak = computeStreak(allEvents, goal);
  const avgMl =
    recentDays.length > 0
      ? Math.round(recentDays.reduce((a, b) => a + b.total, 0) / recentDays.length)
      : 0;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: text }]}>Activity</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Today's snapshot */}
        <View style={styles.statsRow}>
          <MiniCard
            card={card}
            sub={sub}
            icon="today-outline"
            label="Today"
            value={
              todayTotal >= 1000
                ? `${(todayTotal / 1000).toFixed(2)}L`
                : `${todayTotal}ml`
            }
            color={status.color}
          />
          <MiniCard
            card={card}
            sub={sub}
            icon="flame-outline"
            label="Streak"
            value={`${longestStreak}d`}
            color="#FF9500"
          />
          <MiniCard
            card={card}
            sub={sub}
            icon="stats-chart-outline"
            label="Avg / Day"
            value={avgMl >= 1000 ? `${(avgMl / 1000).toFixed(2)}L` : `${avgMl}ml`}
            color="#5AC8FA"
          />
        </View>

        {/* Recent days */}
        <View style={[styles.section, { backgroundColor: card }]}>
          <Text style={[styles.sectionTitle, { color: text }]}>Recent Activity</Text>
          {recentDays.length === 0 ? (
            <Text style={[styles.empty, { color: sub }]}>
              No activity yet. Connect your smart bottle to begin.
            </Text>
          ) : (
            recentDays.map((day) => {
              const s = getHydrationStatus(day.total, goal);
              const pct = Math.min(100, Math.round((day.total / goal) * 100));
              return (
                <View
                  key={day.date_str}
                  style={[
                    styles.dayRow,
                    { borderBottomColor: isDark ? '#2C2C3E' : '#F0F0F0' },
                  ]}
                >
                  <View style={{ width: 80 }}>
                    <Text style={[styles.dayLabel, { color: text }]}>{day.label}</Text>
                    <Text style={[styles.dayCount, { color: sub }]}>
                      {day.count} drink{day.count !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={styles.barWrap}>
                    <View style={styles.barBg}>
                      <View
                        style={[
                          styles.barFill,
                          { width: `${pct}%` as any, backgroundColor: s.color },
                        ]}
                      />
                    </View>
                    <Text style={[styles.dayTotal, { color: sub }]}>
                      {day.total >= 1000
                        ? `${(day.total / 1000).toFixed(2)}L`
                        : `${day.total}ml`}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* All-time stats */}
        <View style={[styles.section, { backgroundColor: card }]}>
          <Text style={[styles.sectionTitle, { color: text }]}>All-Time Stats</Text>
          <StatRow
            text={text}
            sub={sub}
            label="Total drinks logged"
            value={String(allEvents.length)}
          />
          <StatRow
            text={text}
            sub={sub}
            label="Total water consumed"
            value={(() => {
              const t = allEvents.reduce((a, b) => a + b.volume_ml, 0);
              return t >= 1000 ? `${(t / 1000).toFixed(2)} L` : `${Math.round(t)} ml`;
            })()}
          />
          <StatRow
            text={text}
            sub={sub}
            label="Days with data"
            value={String(recentDays.length)}
          />
          <StatRow
            text={text}
            sub={sub}
            label="Goal met (last 14 days)"
            value={`${recentDays.filter((d) => d.total >= goal).length} / ${recentDays.length}`}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 24, fontWeight: '700' },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  miniCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  miniValue: { fontSize: 16, fontWeight: '700' },
  miniLabel: { fontSize: 11, textAlign: 'center' },
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  empty: { fontSize: 14, paddingVertical: 12 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 12,
  },
  dayLabel: { fontSize: 13, fontWeight: '600' },
  dayCount: { fontSize: 12, marginTop: 2 },
  barWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  barBg: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5EEF8',
    overflow: 'hidden',
  },
  barFill: { height: 10, borderRadius: 5 },
  dayTotal: { fontSize: 12, width: 52, textAlign: 'right' },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  statLabel: { fontSize: 14 },
  statValue: { fontSize: 14, fontWeight: '600' },
});
