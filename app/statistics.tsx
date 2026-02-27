import React, { useCallback, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LineChart, BarChart } from 'react-native-chart-kit';

import {
  getDailyTotalMl,
  getDrinkEventsByDate,
  getWeeklyTotals,
  getUserProfile,
  todayDateStr,
} from '../services/database';
import type { DrinkEvent, UserProfileLocal } from '../services/database';
import { getHydrationStatus } from '../services/hydration';

type RangeKey = 'today' | 'week';

const SCREEN_WIDTH = Dimensions.get('window').width;

export default function StatisticsScreen() {
  const isDark = useColorScheme() === 'dark';
  const bg = isDark ? '#121212' : '#F2F7FF';
  const card = isDark ? '#1E1E2E' : '#FFFFFF';
  const textColor = isDark ? '#ECEDEE' : '#11181C';
  const sub = isDark ? '#9BA1A6' : '#687076';

  const [range, setRange] = useState<RangeKey>('today');
  const [profile, setProfile] = useState<UserProfileLocal | null>(null);
  const [todayEvents, setTodayEvents] = useState<DrinkEvent[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [weeklyData, setWeeklyData] = useState<{ date_str: string; total: number }[]>([]);

  const todayStr = todayDateStr();

  const refreshData = useCallback(async () => {
    const [p, total, events, weekly] = await Promise.all([
      getUserProfile(),
      getDailyTotalMl(todayStr),
      getDrinkEventsByDate(todayStr),
      getWeeklyTotals(),
    ]);
    setProfile(p);
    setTodayTotal(total);
    setTodayEvents(events);
    setWeeklyData(weekly);
  }, [todayStr]);

  useFocusEffect(
    useCallback(() => {
      refreshData();
    }, [refreshData])
  );

  const goal = profile?.daily_goal_ml ?? 2000;
  const status = getHydrationStatus(todayTotal, goal);

  // ─── Today's hourly chart data ────────────────────────────────────────────

  const hourlyMap: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourlyMap[h] = 0;
  todayEvents.forEach((e) => {
    const h = new Date(e.timestamp).getHours();
    hourlyMap[h] += e.volume_ml;
  });

  const displayHours = [6, 8, 10, 12, 14, 16, 18, 20, 22];
  const hourlyLabels = displayHours.map((h) => `${h}h`);
  const hourlyValues = displayHours.map((h) => Math.round(hourlyMap[h]));

  // ─── Weekly bar chart data ────────────────────────────────────────────────

  const last7: { label: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    const found = weeklyData.find((w) => w.date_str === ds);
    last7.push({
      label: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      total: found ? Math.round(found.total) : 0,
    });
  }

  const chartConfig = {
    backgroundGradientFrom: card,
    backgroundGradientTo: card,
    color: (opacity = 1) => `rgba(0, 122, 255, ${opacity})`,
    labelColor: () => sub,
    strokeWidth: 2,
    barPercentage: 0.6,
    decimalPlaces: 0,
    propsForDots: { r: '4', strokeWidth: '2', stroke: '#007AFF' },
  };

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Range toggle */}
      <View style={[styles.rangeRow, { backgroundColor: card }]}>
        {(['today', 'week'] as RangeKey[]).map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.rangeBtn, range === r && { backgroundColor: '#007AFF' }]}
            onPress={() => setRange(r)}
          >
            <Text style={[styles.rangeBtnText, { color: range === r ? '#FFF' : sub }]}>
              {r === 'today' ? 'Today' : 'Last 7 Days'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {range === 'today' ? (
          <>
            {/* Today summary cards */}
            <View style={styles.summaryRow}>
              <SummaryCard
                card={card}
                text={textColor}
                sub={sub}
                label="Total Intake"
                value={
                  todayTotal >= 1000
                    ? `${(todayTotal / 1000).toFixed(2)}L`
                    : `${Math.round(todayTotal)}ml`
                }
                color="#007AFF"
              />
              <SummaryCard
                card={card}
                text={textColor}
                sub={sub}
                label="Goal"
                value={goal >= 1000 ? `${(goal / 1000).toFixed(1)}L` : `${goal}ml`}
                color="#34C759"
              />
              <SummaryCard
                card={card}
                text={textColor}
                sub={sub}
                label="Progress"
                value={`${status.percentage}%`}
                color={status.color}
              />
            </View>

            {/* Hourly line chart */}
            <View style={[styles.chartCard, { backgroundColor: card }]}>
              <Text style={[styles.chartTitle, { color: textColor }]}>Hourly Intake (ml)</Text>
              {todayEvents.length === 0 ? (
                <EmptyChart sub={sub} />
              ) : (
                <LineChart
                  data={{
                    labels: hourlyLabels,
                    datasets: [{ data: hourlyValues.some((v) => v > 0) ? hourlyValues : [0] }],
                  }}
                  width={SCREEN_WIDTH - 64}
                  height={180}
                  chartConfig={chartConfig}
                  bezier
                  style={styles.chart}
                  withInnerLines={false}
                  fromZero
                />
              )}
            </View>

            {/* Goal progress bar */}
            <View style={[styles.chartCard, { backgroundColor: card }]}>
              <Text style={[styles.chartTitle, { color: textColor }]}>Goal Progress</Text>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min(100, status.percentage)}%` as any,
                      backgroundColor: status.color,
                    },
                  ]}
                />
              </View>
              <View style={styles.progressBarLabels}>
                <Text style={[styles.progressBarLabel, { color: sub }]}>0</Text>
                <Text style={[styles.progressBarLabel, { color: status.color }]}>
                  {status.percentage}% — {status.label}
                </Text>
                <Text style={[styles.progressBarLabel, { color: sub }]}>
                  {goal >= 1000 ? `${(goal / 1000).toFixed(1)}L` : `${goal}ml`}
                </Text>
              </View>
            </View>

            {/* Drink log */}
            <View style={[styles.chartCard, { backgroundColor: card }]}>
              <Text style={[styles.chartTitle, { color: textColor }]}>Drink Log</Text>
              {todayEvents.length === 0 ? (
                <Text style={[styles.emptyText, { color: sub }]}>No drinks recorded today.</Text>
              ) : (
                [...todayEvents].reverse().map((e, i) => {
                  const t = new Date(e.timestamp);
                  return (
                    <View
                      key={e.id ?? i}
                      style={[
                        styles.logRow,
                        { borderBottomColor: isDark ? '#2C2C3E' : '#F0F0F0' },
                      ]}
                    >
                      <Text style={[styles.logTime, { color: sub }]}>
                        {t.toLocaleTimeString('en-GB', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                      <Text style={[styles.logVol, { color: textColor }]}>
                        {e.volume_ml >= 1000
                          ? `${(e.volume_ml / 1000).toFixed(2)} L`
                          : `${Math.round(e.volume_ml)} ml`}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </>
        ) : (
          <>
            {/* Weekly bar chart */}
            <View style={[styles.chartCard, { backgroundColor: card }]}>
              <Text style={[styles.chartTitle, { color: textColor }]}>
                Daily Intake — Last 7 Days (ml)
              </Text>
              {last7.every((d) => d.total === 0) ? (
                <EmptyChart sub={sub} />
              ) : (
                <BarChart
                  data={{
                    labels: last7.map((d) => d.label),
                    datasets: [{ data: last7.map((d) => d.total) }],
                  }}
                  width={SCREEN_WIDTH - 64}
                  height={200}
                  chartConfig={chartConfig}
                  style={styles.chart}
                  fromZero
                  showValuesOnTopOfBars
                  yAxisLabel=""
                  yAxisSuffix=""
                  withInnerLines={false}
                />
              )}
            </View>

            {/* Weekly summary rows */}
            <View style={[styles.chartCard, { backgroundColor: card }]}>
              <Text style={[styles.chartTitle, { color: textColor }]}>Weekly Summary</Text>
              {last7.map((d, i) => {
                const pct =
                  goal > 0 ? Math.min(100, Math.round((d.total / goal) * 100)) : 0;
                const s = getHydrationStatus(d.total, goal);
                return (
                  <View
                    key={i}
                    style={[
                      styles.weekRow,
                      { borderBottomColor: isDark ? '#2C2C3E' : '#F0F0F0' },
                    ]}
                  >
                    <Text style={[styles.weekDay, { color: textColor }]}>{d.label}</Text>
                    <View style={styles.weekBarWrap}>
                      <View style={styles.weekBarBg}>
                        <View
                          style={[
                            styles.weekBarFill,
                            { width: `${pct}%` as any, backgroundColor: s.color },
                          ]}
                        />
                      </View>
                      <Text style={[styles.weekMl, { color: sub }]}>
                        {d.total >= 1000
                          ? `${(d.total / 1000).toFixed(2)}L`
                          : `${d.total}ml`}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* 7-day aggregate stats */}
            <View style={styles.summaryRow}>
              <SummaryCard
                card={card}
                text={textColor}
                sub={sub}
                label="7-Day Total"
                value={(() => {
                  const t = last7.reduce((a, b) => a + b.total, 0);
                  return t >= 1000 ? `${(t / 1000).toFixed(1)}L` : `${t}ml`;
                })()}
                color="#007AFF"
              />
              <SummaryCard
                card={card}
                text={textColor}
                sub={sub}
                label="Daily Avg"
                value={(() => {
                  const avg = last7.reduce((a, b) => a + b.total, 0) / 7;
                  return avg >= 1000
                    ? `${(avg / 1000).toFixed(2)}L`
                    : `${Math.round(avg)}ml`;
                })()}
                color="#5AC8FA"
              />
              <SummaryCard
                card={card}
                text={textColor}
                sub={sub}
                label="Goal Days"
                value={`${last7.filter((d) => d.total >= goal).length}/7`}
                color="#34C759"
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SummaryCard({
  card,
  text,
  sub,
  label,
  value,
  color,
}: {
  card: string;
  text: string;
  sub: string;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={[styles.summaryCard, { backgroundColor: card }]}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: sub }]}>{label}</Text>
    </View>
  );
}

function EmptyChart({ sub }: { sub: string }) {
  return (
    <View style={styles.emptyChart}>
      <Text style={[styles.emptyText, { color: sub }]}>No data yet</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rangeRow: {
    flexDirection: 'row',
    margin: 16,
    borderRadius: 12,
    padding: 4,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  rangeBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  rangeBtnText: { fontSize: 14, fontWeight: '600' },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  summaryCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  summaryValue: { fontSize: 18, fontWeight: '700' },
  summaryLabel: { fontSize: 11, marginTop: 4, textAlign: 'center' },
  chartCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  chartTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  chart: { borderRadius: 12 },
  emptyChart: { height: 100, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 14 },
  progressBarBg: {
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E5EEF8',
    overflow: 'hidden',
  },
  progressBarFill: { height: 18, borderRadius: 9 },
  progressBarLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  progressBarLabel: { fontSize: 12 },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  logTime: { fontSize: 14 },
  logVol: { fontSize: 14, fontWeight: '600' },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 12,
  },
  weekDay: { width: 36, fontSize: 14, fontWeight: '600' },
  weekBarWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekBarBg: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5EEF8',
    overflow: 'hidden',
  },
  weekBarFill: { height: 10, borderRadius: 5 },
  weekMl: { fontSize: 12, width: 52, textAlign: 'right' },
});
