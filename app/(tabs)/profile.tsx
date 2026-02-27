import React, { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useRouter, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { getUserProfile, saveUserProfile } from '../../services/database';
import {
  calculateDailyGoalMl,
  buildRecommendation,
  calculateAge,
} from '../../services/hydration';

export default function ProfileTab() {
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();

  const bg = isDark ? '#121212' : '#F2F7FF';
  const card = isDark ? '#1E1E2E' : '#FFFFFF';
  const text = isDark ? '#ECEDEE' : '#11181C';
  const sub = isDark ? '#9BA1A6' : '#687076';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [gender, setGender] = useState('Male');
  const [dob, setDob] = useState(new Date(2000, 0, 1));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [goalMl, setGoalMl] = useState(2000);
  const [recommendation, setRecommendation] = useState('');
  const [saved, setSaved] = useState(false);

  const formattedDob = `${String(dob.getDate()).padStart(2, '0')}/${String(
    dob.getMonth() + 1
  ).padStart(2, '0')}/${dob.getFullYear()}`;

  // ─── Load saved profile ──────────────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const p = await getUserProfile();
        if (p) {
          setName(p.name);
          setDescription(p.description);
          setGender(p.gender);
          setHeight(String(p.height_cm));
          setWeight(String(p.weight_kg));
          setGoalMl(p.daily_goal_ml);
          setRecommendation(buildRecommendation(
            { gender: p.gender, dob: p.dob, height_cm: p.height_cm, weight_kg: p.weight_kg },
            p.daily_goal_ml
          ));
          // Parse stored dob back to Date
          const parts = p.dob.split('/');
          if (parts.length === 3) {
            const d = new Date(
              parseInt(parts[2], 10),
              parseInt(parts[1], 10) - 1,
              parseInt(parts[0], 10)
            );
            if (!isNaN(d.getTime())) setDob(d);
          }
        }
      })();
    }, [])
  );

  // Recalculate goal live as profile inputs change
  const recalculate = useCallback(() => {
    const h = parseInt(height, 10) || 170;
    const w = parseInt(weight, 10) || 70;
    const goal = calculateDailyGoalMl({
      gender,
      dob: formattedDob,
      height_cm: h,
      weight_kg: w,
    });
    const rec = buildRecommendation(
      { gender, dob: formattedDob, height_cm: h, weight_kg: w },
      goal
    );
    setGoalMl(goal);
    setRecommendation(rec);
  }, [gender, dob, height, weight, formattedDob]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter your name.');
      return;
    }
    const h = parseInt(height, 10);
    const w = parseInt(weight, 10);
    if (isNaN(h) || h < 50 || h > 280) {
      Alert.alert('Invalid height', 'Please enter a height between 50 and 280 cm.');
      return;
    }
    if (isNaN(w) || w < 10 || w > 500) {
      Alert.alert('Invalid weight', 'Please enter a weight between 10 and 500 kg.');
      return;
    }

    const goal = calculateDailyGoalMl({
      gender,
      dob: formattedDob,
      height_cm: h,
      weight_kg: w,
    });

    try {
      await saveUserProfile({
        name: name.trim(),
        description: description.trim(),
        gender,
        dob: formattedDob,
        height_cm: h,
        weight_kg: w,
        daily_goal_ml: goal,
      });
      setGoalMl(goal);
      setRecommendation(
        buildRecommendation({ gender, dob: formattedDob, height_cm: h, weight_kg: w }, goal)
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save profile');
    }
  };

  const age = calculateAge(formattedDob);

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: text }]}>Profile</Text>
        <Link href="/settings" asChild>
          <TouchableOpacity>
            <Ionicons name="settings-outline" size={26} color={text} />
          </TouchableOpacity>
        </Link>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Avatar / initials */}
        <View style={[styles.avatarCircle, { backgroundColor: '#007AFF' }]}>
          <Text style={styles.avatarText}>
            {name.trim() ? name.trim()[0].toUpperCase() : '?'}
          </Text>
        </View>

        {/* Name */}
        <Field label="Name" isDark={isDark} text={text} sub={sub}>
          <TextInput
            style={[styles.input, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
            value={name}
            onChangeText={setName}
            placeholder="Full name"
            placeholderTextColor={sub}
          />
        </Field>

        {/* Description */}
        <Field label="About me" isDark={isDark} text={text} sub={sub}>
          <TextInput
            style={[styles.input, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
            value={description}
            onChangeText={setDescription}
            placeholder="Short bio or tagline"
            placeholderTextColor={sub}
          />
        </Field>

        {/* Gender */}
        <Field label="Gender" isDark={isDark} text={text} sub={sub}>
          <View style={[styles.pickerWrapper, { borderColor: isDark ? '#333' : '#DDD' }]}>
            <Picker
              selectedValue={gender}
              onValueChange={(v) => { setGender(v); recalculate(); }}
              style={{ color: text }}
              dropdownIconColor={text}
            >
              <Picker.Item label="Male" value="Male" />
              <Picker.Item label="Female" value="Female" />
              <Picker.Item label="Other" value="Other" />
              <Picker.Item label="Prefer not to say" value="Prefer not to say" />
            </Picker>
          </View>
        </Field>

        {/* Date of Birth */}
        <Field label={`Date of Birth${age ? `  ·  Age ${age}` : ''}`} isDark={isDark} text={text} sub={sub}>
          <TouchableOpacity
            style={[styles.input, styles.dobRow, { borderColor: isDark ? '#333' : '#DDD' }]}
            onPress={() => setShowDatePicker(true)}
          >
            <Text style={{ color: text, fontSize: 15 }}>{formattedDob}</Text>
            <Ionicons name="calendar-outline" size={18} color={sub} />
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={dob}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              maximumDate={new Date()}
              onChange={(_: DateTimePickerEvent, d?: Date) => {
                setShowDatePicker(false);
                if (d) { setDob(d); recalculate(); }
              }}
            />
          )}
        </Field>

        {/* Height */}
        <Field label="Height (cm)" isDark={isDark} text={text} sub={sub}>
          <TextInput
            style={[styles.input, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
            value={height}
            onChangeText={(v) => { setHeight(v); recalculate(); }}
            placeholder="e.g. 170"
            keyboardType="numeric"
            placeholderTextColor={sub}
          />
        </Field>

        {/* Weight */}
        <Field label="Weight (kg)" isDark={isDark} text={text} sub={sub}>
          <TextInput
            style={[styles.input, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
            value={weight}
            onChangeText={(v) => { setWeight(v); recalculate(); }}
            placeholder="e.g. 70"
            keyboardType="numeric"
            placeholderTextColor={sub}
          />
        </Field>

        {/* Hydration goal card */}
        <View style={[styles.goalCard, { backgroundColor: card }]}>
          <View style={styles.goalRow}>
            <Ionicons name="water" size={24} color="#007AFF" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.goalLabel, { color: sub }]}>Daily Hydration Goal</Text>
              <Text style={[styles.goalValue, { color: text }]}>
                {goalMl >= 1000
                  ? `${(goalMl / 1000).toFixed(1)} L`
                  : `${goalMl} ml`}{' '}
                / day
              </Text>
            </View>
          </View>
          {recommendation.length > 0 && (
            <Text style={[styles.recommendation, { color: sub }]}>{recommendation}</Text>
          )}
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={[styles.saveButton, saved && { backgroundColor: '#34C759' }]}
          onPress={handleSave}
        >
          <Text style={styles.saveButtonText}>
            {saved ? 'Saved!' : 'Save Profile'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  isDark,
  text,
  sub,
  children,
}: {
  label: string;
  isDark: boolean;
  text: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: sub }]}>{label}</Text>
      {children}
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
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 8,
  },
  avatarText: { color: '#FFF', fontSize: 34, fontWeight: '700' },
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  dobRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerWrapper: { borderWidth: 1, borderRadius: 10 },
  goalCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  goalRow: { flexDirection: 'row', alignItems: 'center' },
  goalLabel: { fontSize: 13, fontWeight: '600' },
  goalValue: { fontSize: 22, fontWeight: '700', marginTop: 2 },
  recommendation: { fontSize: 13, marginTop: 12, lineHeight: 20 },
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
