import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

// Expo Router setting: anchor stack to (tabs)
export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        {/* Tabs (Overview, Hydration, Activity, Profile) */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        {/* Statistics page */}
        <Stack.Screen name="statistics" options={{ title: 'Statistics' }} />

        {/* Settings page */}
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />

        {/* Modal page with proper presentation */}
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', title: 'Modal' }}
        />
      </Stack>

      {/* Status bar adapts to theme */}
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}