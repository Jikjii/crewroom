import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as SystemUI from "expo-system-ui";

export type ThemePreference = "system" | "light" | "dark";
const storageKey = "crewroom.appearance.v1";
const isPreference = (value: unknown): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

export const lightPalette = {
  bg: "#F6F5F0", white: "#FFFFFF", ink: "#17283B", muted: "#5D6878",
  body: "#536277", line: "#E1E5E8", blue: "#335BD6", accent: "#335BD6",
  onAccent: "#FFFFFF", pale: "#EAF0FF", lavender: "#EAE5F8",
  green: "#24745A", mint: "#E4F2EA", orange: "#AD482B", peach: "#FCEBDF",
  soft: "#EDEFEA", subdued: "#EEF0F2", hero: "#E9EEFA", profile: "#EAE6F2",
  image: "#E3E6E8", placeholder: "#657181", borderStrong: "#B7C1CC",
  selectionBorder: "#9BB2ED", danger: "#AD3733", dangerBg: "#FCE7E6",
  overlay: "rgba(13,28,47,.42)", imageBadge: "rgba(255,255,255,.94)",
  inverse: "#17283B", onInverse: "#FFFFFF", demo: "#EDEAE1",
};
export type Palette = { [K in keyof typeof lightPalette]: string };
export const darkPalette: Palette = {
  bg: "#111721", white: "#1B2431", ink: "#EFF2F8", muted: "#A3AFBF",
  body: "#BECCDD", line: "#334050", blue: "#ADC1FF", accent: "#4264D4",
  onAccent: "#FFFFFF", pale: "#263654", lavender: "#39304F",
  green: "#8CD9B7", mint: "#203D34", orange: "#F4B395", peach: "#483129",
  soft: "#252E35", subdued: "#2B3543", hero: "#233148", profile: "#322D45",
  image: "#2C3745", placeholder: "#9BA9BB", borderStrong: "#64738B",
  selectionBorder: "#829CE9", danger: "#FFB5AE", dangerBg: "#492C32",
  overlay: "rgba(0,0,0,.66)", imageBadge: "rgba(27,36,49,.95)",
  inverse: "#DCE6F5", onInverse: "#17283B", demo: "#373329",
};

type ThemeValue = {
  C: Palette;
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (value: ThemePreference) => void;
  ready: boolean;
  storageError: string;
};
const ThemeContext = createContext<ThemeValue | null>(null);

function initialPreference(): ThemePreference {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    try {
      const saved = localStorage.getItem(storageKey);
      if (isPreference(saved)) return saved;
    } catch { /* Storage can be unavailable in private browser contexts. */ }
  }
  return "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [preference, setValue] = useState<ThemePreference>(initialPreference);
  const [ready, setReady] = useState(Platform.OS === "web");
  const [storageError, setStorageError] = useState("");
  const changed = useRef(false);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const resolved = preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
  const C = resolved === "dark" ? darkPalette : lightPalette;

  useEffect(() => {
    if (Platform.OS === "web") return;
    let mounted = true;
    void SecureStore.getItemAsync(storageKey).then((saved) => {
      if (mounted && !changed.current && isPreference(saved)) setValue(saved);
    }).catch(() => {
      if (mounted && !changed.current) setStorageError("Your appearance preference could not be loaded on this device.");
    }).finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);

  const setPreference = useCallback((value: ThemePreference) => {
    changed.current = true;
    setValue(value);
    setStorageError("");
    // Serialize writes so the last selection always wins, even when toggled quickly.
    writes.current = writes.current.then(async () => {
      try {
        if (Platform.OS === "web") localStorage.setItem(storageKey, value);
        else await SecureStore.setItemAsync(storageKey, value);
        setStorageError("");
      } catch {
        setStorageError("This appearance is active, but could not be saved on this device.");
      }
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" && ready) {
      // React Native 0.86 uses "unspecified" to restore the OS appearance.
      Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
    }
  }, [preference, ready]);

  useEffect(() => {
    if (Platform.OS !== "web") {
      void SystemUI.setBackgroundColorAsync(C.bg).catch(() => { /* A root view is not available in every preview host. */ });
      return;
    }
    if (typeof document === "undefined") return;
    document.documentElement.style.colorScheme = resolved;
    document.documentElement.style.backgroundColor = C.bg;
    document.body.style.backgroundColor = C.bg;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", C.bg);
  }, [C, resolved]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setValue(isPreference(event.newValue) ? event.newValue : "system");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => ({ C, preference, resolved, setPreference, ready, storageError }),
    [C, preference, resolved, setPreference, ready, storageError]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("Crewroom theme must be used inside ThemeProvider.");
  return theme;
}

// Member colors are stored in existing workspaces and can be light in either theme.
export function readableOnColor(background: string) {
  const rgb = /^#([\da-f]{6})$/i.exec(background)?.[1];
  if (!rgb) return "#17283B";
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(rgb.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return luminance > .3 ? "#17283B" : "#EFF2F8";
}
