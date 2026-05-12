/**
 * Bottle Setup — configures the bottle so the app can convert
 * sensor drop_mm readings into volume_ml.
 *
 * Two modes:
 *  'dimensions' — ML_PER_MM = π × radius_mm² / 1000
 *  'capacity'   — ML_PER_MM = capacity_ml / height_mm
 *                 Height comes from sensor calibration or manual input.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  getState as getBtState,
  resetBottleNotConfiguredDebounce,
  sendCalibrate,
  sendCalibrateEmpty,
} from '../services/bluetooth';
import {
  getUserProfile,
  saveBottleConfig,
  saveCalEmptyMm,
  saveCalFullMm,
} from '../services/database';
import {
  calculateMlPerMm,
  estimatedCapacityMl,
  validateBottleConfig,
  type BottleInputMode,
} from '../services/bottle';

type CalState = 'idle' | 'running' | 'ok' | 'fail';

export default function BottleSetupScreen() {
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();

  const bg   = isDark ? '#121212' : '#F2F7FF';
  const card = isDark ? '#1E1E2E' : '#FFFFFF';
  const text = isDark ? '#ECEDEE' : '#11181C';
  const sub  = isDark ? '#9BA1A6' : '#687076';
  const sep  = isDark ? '#2C2C3E' : '#F0F0F0';

  // Form state
  const [mode, setMode]           = useState<BottleInputMode>('dimensions');
  const [capacityMl, setCapacityMl]       = useState('');
  const [heightCm, setHeightCm]           = useState('');
  const [diameterCm, setDiameterCm]       = useState('');
  const [calFullMm, setCalFullMm]         = useState(0);
  const [calEmptyMm, setCalEmptyMm]       = useState(0);
  const [saved, setSaved]                 = useState(false);

  // Calibration button states
  const [calFullState, setCalFullState]   = useState<CalState>('idle');
  const [calEmptyState, setCalEmptyState] = useState<CalState>('idle');

  // Load existing config on focus 
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const profile = await getUserProfile();
        if (!profile) return;
        setMode((profile.bottle_input_mode as BottleInputMode) ?? 'dimensions');
        setCapacityMl(profile.bottle_capacity_ml > 0 ? String(profile.bottle_capacity_ml) : '');
        setHeightCm(profile.bottle_height_cm > 0 ? String(profile.bottle_height_cm) : '');
        setDiameterCm(profile.bottle_diameter_cm > 0 ? String(profile.bottle_diameter_cm) : '');
        setCalFullMm(profile.cal_full_mm ?? 0);
        setCalEmptyMm(profile.cal_empty_mm ?? 0);
      })();
    }, [])
  );

  // Derived / preview values for user feedback as they fill the form
  const previewConfig = {
    mode,
    capacity_ml:   parseFloat(capacityMl)  || 0,
    height_cm:     parseFloat(heightCm)    || 0,
    diameter_cm:   parseFloat(diameterCm)  || 0,
    cal_full_mm:   calFullMm,
    cal_empty_mm:  calEmptyMm,
  };

  const previewMlPerMm = calculateMlPerMm(previewConfig);

  // For capacity mode: show where the height is coming from
  const calHeightMm = calEmptyMm - calFullMm;
  const hasCalHeight = calFullMm > 0 && calEmptyMm > 0 && calHeightMm > 5;
  const heightSourceLabel = hasCalHeight
    ? `From sensor: ${calHeightMm.toFixed(1)} mm`
    : previewConfig.height_cm > 0
    ? `Manual: ${(previewConfig.height_cm * 10).toFixed(0)} mm`
    : 'Not set — enter height or use calibration buttons';

  // For dimensions mode: show estimated capacity
  const estCapacity = mode === 'dimensions'
    ? estimatedCapacityMl(previewConfig.height_cm, previewConfig.diameter_cm)
    : 0;

  // Calibration handlers 

  const handleCalibrateFull = async () => {
    if (getBtState().status !== 'connected') {
      Alert.alert('Not Connected', 'Connect your smart bottle first.');
      return;
    }
    Alert.alert(
      'Calibrate Full',
      'Fill the bottle completely, then tap Calibrate.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Calibrate',
          onPress: async () => {
            setCalFullState('running');
            try {
              const result = await sendCalibrate();
              if (result.success && result.raw_mm != null) {
                setCalFullMm(result.raw_mm);
                await saveCalFullMm(result.raw_mm);
                setCalFullState('ok');
                setTimeout(() => setCalFullState('idle'), 4000);
              } else {
                setCalFullState('fail');
                setTimeout(() => setCalFullState('idle'), 4000);
                Alert.alert('Calibration Failed', 'Sensor reading out of range. Ensure the bottle is full.');
              }
            } catch (e: any) {
              setCalFullState('fail');
              setTimeout(() => setCalFullState('idle'), 4000);
              Alert.alert('Error', e?.message ?? 'Calibration error');
            }
          },
        },
      ]
    );
  };

  const handleCalibrateEmpty = async () => {
    if (getBtState().status !== 'connected') {
      Alert.alert('Not Connected', 'Connect your smart bottle first.');
      return;
    }
    Alert.alert(
      'Calibrate Empty',
      'Empty the bottle completely, then tap Calibrate.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Calibrate',
          onPress: async () => {
            setCalEmptyState('running');
            try {
              const result = await sendCalibrateEmpty();
              if (result.success && result.raw_mm != null) {
                setCalEmptyMm(result.raw_mm);
                await saveCalEmptyMm(result.raw_mm);
                setCalEmptyState('ok');
                setTimeout(() => setCalEmptyState('idle'), 4000);
              } else {
                setCalEmptyState('fail');
                setTimeout(() => setCalEmptyState('idle'), 4000);
                Alert.alert('Calibration Failed', 'Sensor reading out of range. Ensure the bottle is completely empty.');
              }
            } catch (e: any) {
              setCalEmptyState('fail');
              setTimeout(() => setCalEmptyState('idle'), 4000);
              Alert.alert('Error', e?.message ?? 'Calibration error');
            }
          },
        },
      ]
    );
  };

  // Save 

  const handleSave = async () => {
    const validation = validateBottleConfig({
      mode,
      capacity_ml:  parseFloat(capacityMl)  || 0,
      height_cm:    parseFloat(heightCm)    || 0,
      diameter_cm:  parseFloat(diameterCm)  || 0,
      cal_full_mm:  calFullMm,
      cal_empty_mm: calEmptyMm,
    });

    if (!validation.valid) {
      Alert.alert('Invalid Configuration', validation.error ?? 'Please check your inputs.');
      return;
    }

    const mlPerMm = calculateMlPerMm({
      mode,
      capacity_ml:  parseFloat(capacityMl)  || 0,
      height_cm:    parseFloat(heightCm)    || 0,
      diameter_cm:  parseFloat(diameterCm)  || 0,
      cal_full_mm:  calFullMm,
      cal_empty_mm: calEmptyMm,
    });

    try {
      await saveBottleConfig({
        bottle_input_mode:  mode,
        bottle_capacity_ml: parseFloat(capacityMl)  || 0,
        bottle_height_cm:   parseFloat(heightCm)    || 0,
        bottle_diameter_cm: parseFloat(diameterCm)  || 0,
        ml_per_mm:          mlPerMm,
        cal_full_mm:        calFullMm,
        cal_empty_mm:       calEmptyMm,
      });

      // Re-arm debounce so next DRINK packet is evaluated immediately
      resetBottleNotConfiguredDebounce();

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save bottle configuration');
    }
  };

  // Render 

  const isConnected = getBtState().status === 'connected';

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View style={[styles.header, { borderBottomColor: sep }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: text }]}>Bottle Setup</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: sub }]}>
          Tell the app about your bottle so it can convert the sensor reading
          into millilitres.
        </Text>

        <View style={[styles.modeRow, { backgroundColor: isDark ? '#2C2C3E' : '#E8EFF8' }]}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'dimensions' && styles.modeBtnActive]}
            onPress={() => setMode('dimensions')}
          >
            <Ionicons
              name="resize-outline"
              size={16}
              color={mode === 'dimensions' ? '#FFF' : sub}
            />
            <Text style={[styles.modeBtnText, { color: mode === 'dimensions' ? '#FFF' : sub }]}>
              By Dimensions
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'capacity' && styles.modeBtnActive]}
            onPress={() => setMode('capacity')}
          >
            <Ionicons
              name="water-outline"
              size={16}
              color={mode === 'capacity' ? '#FFF' : sub}
            />
            <Text style={[styles.modeBtnText, { color: mode === 'capacity' ? '#FFF' : sub }]}>
              By Capacity
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'dimensions' && (
          <View style={[styles.section, { backgroundColor: card }]}>
            <SectionTitle text={text} icon="resize-outline" label="Bottle Dimensions" />
            <Text style={[styles.sectionDesc, { color: sub }]}>
              Measure the inside of your bottle. Height = water column when full.
              The app uses the cylindrical formula: ML/mm = π × r².
            </Text>

            <Field label="Internal Height (cm)" sub={sub}>
              <TextInput
                style={[styles.input, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
                value={heightCm}
                onChangeText={setHeightCm}
                placeholder="e.g. 20"
                keyboardType="decimal-pad"
                placeholderTextColor={sub}
              />
            </Field>

            <Field label="Internal Diameter (cm)" sub={sub}>
              <TextInput
                style={[styles.input, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
                value={diameterCm}
                onChangeText={setDiameterCm}
                placeholder="e.g. 7"
                keyboardType="decimal-pad"
                placeholderTextColor={sub}
              />
            </Field>

            {estCapacity > 0 && (
              <InfoRow
                label="Estimated capacity"
                value={`≈ ${estCapacity} ml`}
                color="#5AC8FA"
              />
            )}
          </View>
        )}

        {mode === 'capacity' && (
          <View style={[styles.section, { backgroundColor: card }]}>
            <SectionTitle text={text} icon="water-outline" label="Bottle Capacity" />
            <Text style={[styles.sectionDesc, { color: sub }]}>
              Enter your bottle's total capacity. The app divides capacity by
              height to get ML/mm. Height comes from sensor calibration (most
              accurate) or manual input.
            </Text>

            <Field label="Capacity (ml)" sub={sub}>
              <TextInput
                style={[styles.input, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
                value={capacityMl}
                onChangeText={setCapacityMl}
                placeholder="e.g. 750"
                keyboardType="decimal-pad"
                placeholderTextColor={sub}
              />
            </Field>

            {/* Sensor-based height derivation */}
            <Text style={[styles.subHeading, { color: text }]}>
              Height source
            </Text>
            <Text style={[styles.heightSource, { color: hasCalHeight ? '#34C759' : sub }]}>
              {heightSourceLabel}
            </Text>

            <View style={styles.calButtons}>
              <CalButton
                label="Calibrate Full"
                sublabel="Fill bottle, then tap"
                icon="arrow-up-circle-outline"
                calState={calFullState}
                disabled={!isConnected}
                onPress={handleCalibrateFull}
                isDark={isDark}
              />
              <CalButton
                label="Calibrate Empty"
                sublabel="Empty bottle, then tap"
                icon="arrow-down-circle-outline"
                calState={calEmptyState}
                disabled={!isConnected}
                onPress={handleCalibrateEmpty}
                isDark={isDark}
              />
            </View>

            {!isConnected && (
              <Text style={[styles.notConnectedHint, { color: sub }]}>
                Connect your bottle to use sensor calibration.
              </Text>
            )}

            {/* Manual height fallback */}
            <Text style={[styles.subHeading, { color: text, marginTop: 16 }]}>
              Manual height (fallback)
            </Text>
            <Text style={[styles.sectionDesc, { color: sub }]}>
              Used only if sensor calibration above hasn't been done.
            </Text>
            <Field label="Water Column Height (cm)" sub={sub}>
              <TextInput
                style={[styles.input, { color: text, borderColor: isDark ? '#333' : '#DDD' }]}
                value={heightCm}
                onChangeText={setHeightCm}
                placeholder="e.g. 20"
                keyboardType="decimal-pad"
                placeholderTextColor={sub}
              />
            </Field>
          </View>
        )}

        <View style={[styles.resultCard, { backgroundColor: card }]}>
          <SectionTitle text={text} icon="calculator-outline" label="Computed Values" />

          <InfoRow
            label="ML per mm drop"
            value={previewMlPerMm > 0 ? `${previewMlPerMm.toFixed(3)} ml/mm` : 'Not calculable yet'}
            color={previewMlPerMm > 0 ? '#007AFF' : sub}
          />

          {mode === 'capacity' && calFullMm > 0 && (
            <InfoRow label="Calibration: full level"  value={`${calFullMm} mm`}  color={sub} />
          )}
          {mode === 'capacity' && calEmptyMm > 0 && (
            <InfoRow label="Calibration: empty level" value={`${calEmptyMm} mm`} color={sub} />
          )}
          {mode === 'capacity' && hasCalHeight && (
            <InfoRow
              label="Derived bottle height"
              value={`${calHeightMm.toFixed(1)} mm`}
              color="#34C759"
            />
          )}

          {previewMlPerMm > 0 && (
            <Text style={[styles.exampleText, { color: sub }]}>
              Example: a 10 mm sensor drop = {(previewMlPerMm * 10).toFixed(0)} ml
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saved && { backgroundColor: '#34C759' }]}
          onPress={handleSave}
        >
          <Text style={styles.saveButtonText}>{saved ? 'Saved!' : 'Save Configuration'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// Sub-components

function SectionTitle({ text, icon, label }: { text: string; icon: string; label: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Ionicons name={icon as any} size={18} color="#007AFF" />
      <Text style={[styles.sectionTitle, { color: text }]}>{label}</Text>
    </View>
  );
}

function Field({
  label, sub, children,
}: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: sub }]}>{label}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color }]}>{label}</Text>
      <Text style={[styles.infoValue, { color }]}>{value}</Text>
    </View>
  );
}

function CalButton({
  label, sublabel, icon, calState, disabled, onPress, isDark,
}: {
  label: string;
  sublabel: string;
  icon: string;
  calState: CalState;
  disabled: boolean;
  onPress: () => void;
  isDark: boolean;
}) {
  const bgColor =
    calState === 'ok'   ? '#34C759' :
    calState === 'fail' ? '#FF3B30' :
    calState === 'running' ? (isDark ? '#2C2C3E' : '#F0F0F0') :
    '#007AFF';

  const iconName =
    calState === 'ok'      ? 'checkmark-circle' :
    calState === 'fail'    ? 'close-circle'     :
    calState === 'running' ? 'sync'             :
    icon;

  return (
    <TouchableOpacity
      style={[styles.calBtn, { backgroundColor: bgColor, opacity: disabled ? 0.45 : 1 }]}
      onPress={onPress}
      disabled={disabled || calState === 'running'}
    >
      {calState === 'running' ? (
        <ActivityIndicator size="small" color="#FFF" />
      ) : (
        <Ionicons name={iconName as any} size={18} color="#FFF" />
      )}
      <View>
        <Text style={styles.calBtnLabel}>{label}</Text>
        <Text style={styles.calBtnSub}>{sublabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

// Styles

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 52,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 16 },
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 16 },

  // Mode toggle
  modeRow: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
    gap: 4,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 9,
    gap: 6,
  },
  modeBtnActive: { backgroundColor: '#007AFF' },
  modeBtnText: { fontSize: 13, fontWeight: '600' },

  // Section cards
  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  sectionDesc: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  subHeading: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  heightSource: { fontSize: 13, marginBottom: 12 },

  // Fields
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },

  // Calibration buttons
  calButtons: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  calBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 8,
  },
  calBtnLabel: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  calBtnSub: { color: 'rgba(255,255,255,0.8)', fontSize: 11 },
  notConnectedHint: { fontSize: 12, textAlign: 'center', marginTop: 4 },

  // Result card
  resultCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: '600' },
  exampleText: { fontSize: 12, marginTop: 10, fontStyle: 'italic' },

  // Save
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
