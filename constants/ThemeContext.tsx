import React, { createContext, useState, useContext } from 'react';
import { ThemeSettings } from './theme';

const defaultSettings: ThemeSettings = {
  darkMode: false,
  dyslexicFont: false,
  largeFont: false,
};

const ThemeContext = createContext<{
  settings: ThemeSettings;
  setSettings: React.Dispatch<React.SetStateAction<ThemeSettings>>;
}>({
  settings: defaultSettings,
  setSettings: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<ThemeSettings>(defaultSettings);
  return (
    <ThemeContext.Provider value={{ settings, setSettings }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useThemeSettings = () => useContext(ThemeContext);