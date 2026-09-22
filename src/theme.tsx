import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as SystemUI from "expo-system-ui";

export type ThemePreference = "system" | "light" | "dark";
const storageKey = "crewroom.appearance.v1";
const isPreference = (value: unknown): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

export const lightPalette = {
  bg: "#FAF8FC",
  white: "#FFFFFF",
  ink: "#19151F",
  muted: "#6E657C",
  body: "#554C64",
  line: "#E5DEEC",
  blue: "#7E2CB2",
  accent: "#9236CF",
  onAccent: "#FFFFFF",
  pale: "#F0E5FA",
  lavender: "#EDE3F6",
  pink: "#BD176E",
  violet: "#7E2CB2",
  onImage: "#FFFFFF",
  imageScrim: "rgba(9,9,14,.66)",
  green: "#24745A",
  mint: "#E4F2EA",
  orange: "#AD482B",
  peach: "#FCEBDF",
  soft: "#F0ECF5",
  subdued: "#EFEAF4",
  hero: "#EEE3F8",
  profile: "#ECE2F5",
  image: "#E8E0EE",
  placeholder: "#776B85",
  borderStrong: "#B8ACC6",
  selectionBorder: "#9D60C3",
  danger: "#AC294B",
  dangerBg: "#FBE6ED",
  overlay: "rgba(18,10,28,.52)",
  imageBadge: "rgba(255,255,255,.96)",
  inverse: "#211629",
  onInverse: "#FFFFFF",
  demo: "#F0E9F4",
};
export type Palette = { [K in keyof typeof lightPalette]: string };
export const darkPalette: Palette = {
  bg: "#09090E",
  white: "#14131F",
  ink: "#FAF8FF",
  muted: "#A6A0BC",
  body: "#C4BDD2",
  line: "#302D3C",
  blue: "#C591EF",
  accent: "#A546D7",
  onAccent: "#FFFFFF",
  pale: "#281A39",
  lavender: "#382545",
  pink: "#FF2894",
  violet: "#B963EF",
  onImage: "#FFFFFF",
  imageScrim: "rgba(9,9,14,.66)",
  green: "#8CD9B7",
  mint: "#203D34",
  orange: "#F4B395",
  peach: "#483129",
  soft: "#1D1929",
  subdued: "#242031",
  hero: "#1E152B",
  profile: "#251A33",
  image: "#272130",
  placeholder: "#9B92AE",
  borderStrong: "#655970",
  selectionBorder: "#B963EF",
  danger: "#FFA9C0",
  dangerBg: "#44202E",
  overlay: "rgba(0,0,0,.76)",
  imageBadge: "rgba(20,19,31,.96)",
  inverse: "#EEE7F8",
  onInverse: "#211629",
  demo: "#281D31",
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
    } catch {
      /* Storage can be unavailable in private browser contexts. */
    }
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
  const resolved =
    preference === "system"
      ? system === "dark"
        ? "dark"
        : "light"
      : preference;
  const C = resolved === "dark" ? darkPalette : lightPalette;

  useEffect(() => {
    if (Platform.OS === "web") return;
    let mounted = true;
    void SecureStore.getItemAsync(storageKey)
      .then((saved) => {
        if (mounted && !changed.current && isPreference(saved)) setValue(saved);
      })
      .catch(() => {
        if (mounted && !changed.current)
          setStorageError(
            "Your appearance preference could not be loaded on this device.",
          );
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
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
        setStorageError(
          "This appearance is active, but could not be saved on this device.",
        );
      }
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" && ready) {
      // React Native 0.86 uses "unspecified" to restore the OS appearance.
      Appearance.setColorScheme(
        preference === "system" ? "unspecified" : preference,
      );
    }
  }, [preference, ready]);

  useEffect(() => {
    if (Platform.OS !== "web") {
      void SystemUI.setBackgroundColorAsync(C.bg).catch(() => {
        /* A root view is not available in every preview host. */
      });
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

  const value = useMemo(
    () => ({ C, preference, resolved, setPreference, ready, storageError }),
    [C, preference, resolved, setPreference, ready, storageError],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme)
    throw new Error("Crewroom theme must be used inside ThemeProvider.");
  return theme;
}

// Member colors are stored in existing workspaces and can be light in either theme.
export function readableOnColor(background: string) {
  const rgb = /^#([\da-f]{6})$/i.exec(background)?.[1];
  if (!rgb) return "#17283B";
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(rgb.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.3 ? "#17283B" : "#EFF2F8";
}
