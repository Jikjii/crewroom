import React, { useMemo, useState } from "react";
import { useTheme, readableOnColor, type Palette } from "./theme";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
export function Icon({
  name,
  size = 20,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const { C } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? C.ink} />;
}
export function Button({
  title,
  onPress,
  secondary = false,
  small = false,
  disabled = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  small?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const { C, s } = useUI();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        small && s.smallButton,
        { opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      {icon && (
        <Icon name={icon} size={18} color={secondary ? C.blue : C.onAccent} />
      )}
      <Text style={[s.buttonText, secondary && { color: C.blue }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  name,
  label,
  onPress,
  color,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  color?: string;
}) {
  const { C, s } = useUI();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, pressed && { opacity: 0.65 }]}
    >
      <Icon name={name} color={color ?? C.ink} />
    </Pressable>
  );
}
interface AvatarProps {
  name: string;
  color?: string;
  size?: number;
  source?: ImageSourcePropType;
}

export function Avatar(props: AvatarProps) {
  const { source } = props;
  const imageKey = typeof source === "number"
    ? `asset:${source}`
    : Array.isArray(source)
      ? source.map((image) => image.uri ?? "").join("|")
      : source?.uri ?? "initials";
  // A replacement gets fresh image state; late errors from the old image
  // cannot hide a newer profile picture.
  return <AvatarContent key={imageKey} {...props} />;
}

function AvatarContent({
  name,
  color,
  size = 42,
  source,
}: AvatarProps) {
  const { C, s } = useUI();
  const [failed, setFailed] = useState(false);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name}'s profile picture`}
      style={[
        s.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color ?? C.lavender,
          overflow: "hidden",
        },
      ]}
    >
      {source && !failed ? (
        <Image
          source={source}
          resizeMode="cover"
          accessible={false}
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <Text
          accessible={false}
          style={{
            color: readableOnColor(color ?? C.lavender),
            fontWeight: "700",
            fontSize: size * 0.31,
          }}
        >
          {name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </Text>
      )}
    </View>
  );
}
export function Tag({
  children,
  tone = "blue",
}: {
  children: React.ReactNode;
  tone?: "blue" | "green" | "orange" | "muted";
}) {
  const { C, s } = useUI();
  const colors = {
    blue: [C.pale, C.blue],
    green: [C.mint, C.green],
    orange: [C.peach, C.orange],
    muted: [C.subdued, C.muted],
  };
  return (
    <View style={[s.tag, { backgroundColor: colors[tone][0] }]}>
      <Text style={[s.tagText, { color: colors[tone][1] }]}>{children}</Text>
    </View>
  );
}
export function Heading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  const { C, s } = useUI();
  return (
    <View style={s.sectionHeading}>
      <Text style={s.h2}>{title}</Text>
      {action && (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={s.textAction}
        >
          <Text style={s.link}>{action}</Text>
          <Icon name="arrow-forward" size={15} color={C.blue} />
        </Pressable>
      )}
    </View>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder,
  secret = false,
  multiline = false,
  keyboard = "default",
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  secret?: boolean;
  multiline?: boolean;
  keyboard?: "default" | "email-address" | "numeric";
}) {
  const { C, s, resolved } = useUI();
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.placeholder}
        keyboardAppearance={resolved}
        selectionColor={C.blue}
        secureTextEntry={secret}
        multiline={multiline}
        keyboardType={keyboard}
        autoCapitalize={
          keyboard === "email-address" || secret ? "none" : "sentences"
        }
        style={[
          s.input,
          multiline && { minHeight: 90, textAlignVertical: "top" },
        ]}
      />
    </View>
  );
}
export function Empty({
  icon = "sparkles-outline",
  title,
  text,
  action,
  onPress,
}: {
  icon?: IconName;
  title: string;
  text: string;
  action?: string;
  onPress?: () => void;
}) {
  const { C, s } = useUI();
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={27} color={C.blue} />
      </View>
      <Text style={s.h2}>{title}</Text>
      <Text style={[s.body, { textAlign: "center" }]}>{text}</Text>
      {action && onPress && <Button title={action} onPress={onPress} small />}
    </View>
  );
}
export function Loading() {
  const { C, s } = useUI();
  return (
    <View style={s.center}>
      <ActivityIndicator size="large" color={C.blue} />
      <Text style={s.body}>Getting your crew together…</Text>
    </View>
  );
}
const createStyles = (C: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    app: { flex: 1, width: "100%", maxWidth: 1120, alignSelf: "center" },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      gap: 18,
      padding: 30,
    },
    topbar: {
      paddingHorizontal: 24,
      paddingVertical: 14,
      minHeight: 76,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    brand: {
      fontSize: 31,
      fontWeight: "900",
      letterSpacing: -1.5,
      color: C.ink,
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 44,
      flexShrink: 1,
    },
    brandDot: { color: C.pink },
    headerAction: {
      minHeight: 44,
      paddingHorizontal: 10,
      borderRadius: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: C.white,
      borderWidth: 1,
      borderColor: C.line,
    },
    headerActionText: { fontSize: 12, fontWeight: "700", color: C.ink },
    headerAccount: {
      minHeight: 44,
      minWidth: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    between: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    column: { gap: 14 },
    grow: { flex: 1 },
    content: { paddingHorizontal: 24, paddingBottom: 28, gap: 25 },
    eyebrow: {
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1.9,
      color: C.muted,
      textTransform: "uppercase",
    },
    h1: {
      fontSize: 34,
      lineHeight: 40,
      letterSpacing: -1.3,
      fontWeight: "800",
      color: C.ink,
    },
    h2: { fontSize: 20, letterSpacing: -0.6, fontWeight: "800", color: C.ink },
    h3: { fontSize: 16, fontWeight: "700", color: C.ink },
    body: { fontSize: 14, lineHeight: 21, color: C.muted },
    small: { fontSize: 12, lineHeight: 18, color: C.muted },
    link: { fontSize: 13, fontWeight: "700", color: C.blue },
    card: {
      borderRadius: 24,
      backgroundColor: C.white,
      padding: 20,
      borderWidth: 1,
      borderColor: C.line,
      gap: 16,
    },
    sectionHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 13,
    },
    textAction: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    button: {
      backgroundColor: C.accent,
      minHeight: 50,
      paddingHorizontal: 20,
      paddingVertical: 13,
      borderRadius: 28,
      borderWidth: 1,
      borderColor: "transparent",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
    },
    buttonText: { color: C.onAccent, fontSize: 14, fontWeight: "800" },
    secondary: { backgroundColor: C.white, borderColor: C.line },
    smallButton: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 15 },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 24,
      backgroundColor: C.white,
      borderWidth: 1,
      borderColor: C.line,
    },
    avatar: {
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: C.selectionBorder,
    },
    tag: {
      alignSelf: "flex-start",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 20,
    },
    tagText: { fontSize: 11, fontWeight: "700" },
    hero: {
      backgroundColor: C.accent,
      borderRadius: 25,
      padding: 24,
      overflow: "hidden",
      minHeight: 240,
      gap: 16,
    },
    heroTitle: {
      fontSize: 32,
      lineHeight: 37,
      fontWeight: "700",
      color: C.onAccent,
      letterSpacing: -1,
    },
    heroLabel: {
      fontSize: 10,
      fontWeight: "800",
      color: C.onAccent,
      letterSpacing: 1.8,
    },
    heroButton: {
      alignSelf: "flex-start",
      backgroundColor: C.white,
      paddingHorizontal: 17,
      paddingVertical: 13,
      borderRadius: 24,
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
    },
    heroArt: {
      position: "absolute",
      right: -2,
      bottom: 48,
      opacity: 0.9,
      width: 128,
      height: 170,
    },
    artCard: {
      position: "absolute",
      width: 88,
      height: 111,
      borderRadius: 14,
      borderWidth: 3,
      borderColor: C.white,
      padding: 10,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    stats: { flexDirection: "row", gap: 10 },
    stat: {
      flex: 1,
      padding: 14,
      borderRadius: 17,
      backgroundColor: C.white,
      borderWidth: 1,
      borderColor: C.line,
      gap: 4,
    },
    statValue: {
      fontSize: 24,
      fontWeight: "700",
      color: C.ink,
      letterSpacing: -0.8,
    },
    statLabel: { fontSize: 11, color: C.muted },
    dateBox: {
      width: 56,
      backgroundColor: C.pale,
      borderRadius: 15,
      paddingVertical: 10,
      alignItems: "center",
      gap: 1,
    },
    dateMonth: {
      fontSize: 10,
      fontWeight: "800",
      color: C.blue,
      letterSpacing: 1,
    },
    dateDay: { fontSize: 23, fontWeight: "700", color: C.blue },
    divider: { height: 1, backgroundColor: C.line },
    taskRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 54,
    },
    checkbox: {
      width: 27,
      height: 27,
      borderRadius: 9,
      borderWidth: 1.5,
      borderColor: C.borderStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    checked: { backgroundColor: C.accent, borderColor: C.accent },
    taskTitle: {
      fontSize: 14,
      fontWeight: "500",
      color: C.ink,
      lineHeight: 20,
    },
    doneText: { textDecorationLine: "line-through", color: C.muted },
    nav: {
      flexDirection: "row",
      backgroundColor: C.bg,
      borderTopWidth: 1,
      borderColor: C.line,
      paddingTop: 10,
      paddingBottom: 10,
      paddingHorizontal: 12,
    },
    navItem: {
      flex: 1,
      minHeight: 51,
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      borderRadius: 13,
    },
    navActive: { backgroundColor: C.pale },
    navText: { fontSize: 10, fontWeight: "600", color: C.muted },
    tabs: {
      flexDirection: "row",
      gap: 6,
      backgroundColor: C.subdued,
      borderRadius: 13,
      padding: 4,
    },
    tab: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 40,
      paddingHorizontal: 5,
      borderRadius: 10,
    },
    tabActive: { backgroundColor: C.white },
    tabText: { fontSize: 11, fontWeight: "700", color: C.muted },
    progressTrack: {
      height: 6,
      borderRadius: 4,
      backgroundColor: C.subdued,
      overflow: "hidden",
    },
    progressBar: { height: 6, borderRadius: 4, backgroundColor: C.accent },
    empty: {
      padding: 28,
      alignItems: "center",
      gap: 14,
      borderRadius: 22,
      backgroundColor: C.white,
    },
    emptyIcon: { padding: 15, borderRadius: 18, backgroundColor: C.pale },
    modalBackdrop: {
      flex: 1,
      backgroundColor: C.overlay,
      justifyContent: "flex-end",
      alignItems: "center",
    },
    modal: {
      width: "100%",
      maxWidth: 580,
      maxHeight: "93%",
      backgroundColor: C.white,
      borderWidth: 1,
      borderColor: C.line,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 8,
    },
    modalBody: { padding: 24, paddingTop: 12, gap: 18, paddingBottom: 38 },
    fieldLabel: { fontSize: 12, fontWeight: "700", color: C.ink },
    input: {
      backgroundColor: C.white,
      borderWidth: 1,
      borderColor: C.borderStrong,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 13,
      minHeight: 52,
      fontSize: 15,
      color: C.ink,
    },
    error: { backgroundColor: C.dangerBg, padding: 13, borderRadius: 12 },
    errorText: { color: C.danger, fontSize: 13, lineHeight: 19 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      paddingVertical: 11,
      paddingHorizontal: 13,
      borderRadius: 24,
      backgroundColor: C.white,
      borderWidth: 1,
      borderColor: C.line,
      minHeight: 44,
    },
    chipActive: { backgroundColor: C.pale, borderColor: C.selectionBorder },
    chipText: { fontSize: 12, color: C.ink, fontWeight: "600" },
    toast: {
      position: "absolute",
      bottom: 88,
      left: 20,
      right: 20,
      maxWidth: 600,
      alignSelf: "center",
      backgroundColor: C.inverse,
      padding: 15,
      borderRadius: 15,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    toastText: { flex: 1, color: C.onInverse, fontSize: 13, lineHeight: 19 },
    demo: {
      backgroundColor: C.demo,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 13,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
  });

export function useUI() {
  const theme = useTheme();
  const s = useMemo(() => createStyles(theme.C), [theme.C]);
  return { ...theme, s };
}

export function AppearanceControl() {
  const { C, s, preference, resolved, setPreference, storageError } = useUI();
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.h3}>Appearance</Text>
      <Text style={s.body}>Make Crewroom feel at home on your screen.</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Appearance"
        style={[s.row, { gap: 8 }]}
      >
        {(
          [
            {
              value: "system",
              label: "System",
              icon: "phone-portrait-outline",
            },
            { value: "light", label: "Light", icon: "sunny-outline" },
            { value: "dark", label: "Dark", icon: "moon-outline" },
          ] as const
        ).map((option) => {
          const selected = preference === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label} appearance`}
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              onPress={() => setPreference(option.value)}
              style={[
                s.chip,
                {
                  flex: 1,
                  gap: 8,
                  minHeight: 80,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 5,
                },
                selected && s.chipActive,
              ]}
            >
              <Icon
                name={option.icon}
                color={selected ? C.blue : C.muted}
                size={22}
              />
              <Text style={[s.chipText, selected && { color: C.blue }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={s.small}>
        {preference === "system"
          ? `Following your device’s appearance. Currently ${resolved}.`
          : `${preference === "dark" ? "Dark" : "Light"} mode is on.`}
        {storageError ? "" : " Saved on this device."}
      </Text>
      {!!storageError && (
        <Text accessibilityRole="alert" style={s.errorText}>
          {storageError}
        </Text>
      )}
    </View>
  );
}
