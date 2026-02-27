import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet, TouchableOpacity } from 'react-native';

const SettingsScreen: React.FC = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [dyslexicFont, setDyslexicFont] = useState(false);
  const [largeFont, setLargeFont] = useState(false);

  // Dynamic styles based on darkMode
  const backgroundColor = darkMode ? '#121212' : '#f5f5f5';
  const textColor = darkMode ? '#ffffff' : '#000000';
  const buttonColor = darkMode ? '#1e90ff' : '#007AFF';

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <Text style={[styles.title, { color: textColor }]}>Accessibility Settings</Text>

      <View style={styles.option}>
        <Text style={[styles.label, { color: textColor }]}>Dark Mode</Text>
        <Switch value={darkMode} onValueChange={setDarkMode} />
      </View>

      <View style={styles.option}>
        <Text style={[styles.label, { color: textColor }]}>Dyslexic-Friendly Font</Text>
        <Switch value={dyslexicFont} onValueChange={setDyslexicFont} />
      </View>

      <View style={styles.option}>
        <Text style={[styles.label, { color: textColor }]}>Large Font Size</Text>
        <Switch value={largeFont} onValueChange={setLargeFont} />
      </View>

      <TouchableOpacity style={[styles.saveButton, { backgroundColor: buttonColor }]}>
        <Text style={styles.saveText}>Save Preferences</Text>
      </TouchableOpacity>
    </View>
  );
};

export default SettingsScreen;

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 20 },
  option: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 },
  label: { fontSize: 18 },
  saveButton: { marginTop: 30, padding: 15, borderRadius: 8 },
  saveText: { color: '#fff', textAlign: 'center', fontSize: 16 }
});