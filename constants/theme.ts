export const colors = {
  lightBackground: '#f5f5f5',
  darkBackground: '#121212',
  primary: '#007AFF',
  secondary: '#1e90ff',
  textLight: '#ffffff',
  textDark: '#000000',
};

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: '#007AFF',
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: '#007AFF',
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: '#1e90ff',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: '#1e90ff',
  },
};

export const fonts = {
  regular: 'System',
  dyslexic: 'OpenDyslexic-Regular',
};

export const fontSizes = {
  normal: 16,
  large: 20,
};

export interface ThemeSettings {
  darkMode: boolean;
  dyslexicFont: boolean;
  largeFont: boolean;
}