import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { api, getApiBaseUrl, mediaSource, socialApi, type PublicConfig } from "./src/api";
import type { CreatorProfile } from "./src/social/types";
import { AccountCenter, PasswordRecovery } from "./src/account/AccountCenter";
import { PolicyLinks, PublicPageContent, parsePublicPage, type PublicPage } from "./src/account/PublicPages";
import SocialExperience from "./src/social/SocialExperience";
import { ThemeProvider } from "./src/theme";
import { Sheet } from "./src/social/shared";
import type {
  CreatedInvite,
  InvitePreview,
  Member,
  Project,
  ReadinessStatus,
  Session,
  Task,
  Workspace,
} from "./src/types";
import {
  Avatar,
  Button,
  Empty,
  Field,
  Heading,
  Icon,
  IconButton,
  Loading,
  Tag,
  useUI,
  AppearanceControl,
} from "./src/ui";

type SocialRoute = { type: "post" | "profile"; value: string };
const readSocialRoute = (url: string | null): SocialRoute | null => {
  if (!url) return null;
  const match = url.match(/\/(p|u)\/([^/?#]+)/);
  if (!match) return null;
  try {
    return {
      type: match[1] === "p" ? "post" : "profile",
      value: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
};

type Tab = "Today" | "Crews" | "Plans" | "You";
type ProjectTab = "Overview" | "Lineup" | "Checklist" | "Day plan";
type Dialog = {
  kind:
    | "crew"
    | "project"
    | "editProject"
    | "member"
    | "lineup"
    | "task"
    | "agenda"
    | "signup"
    | "login"
    | "recover"
    | "invite"
    | "join"
    | "activity"
    | "removeMember";
  title: string;
  id?: string;
  member?: Member;
};
const blank: Workspace = {
  crews: [],
  projects: [],
  members: [],
  lineup: [],
  tasks: [],
  agenda: [],
  activity: [],
};
const colors = ["#EAE5F8", "#D8EAF5", "#F9DDCB", "#DBEADB", "#F3DAE5"];
const dateParts = (date: string) => {
  const d = date ? new Date(`${date}T12:00:00`) : null;
  return {
    month:
      d?.toLocaleDateString("en-US", { month: "short" }).toUpperCase() || "TBD",
    day: d ? String(d.getDate()) : "—",
    full:
      d?.toLocaleDateString("en-US", {
        weekday: "short",
        month: "long",
        day: "numeric",
      }) || "Date to come",
  };
};
const clock = (time: string) => {
  if (!time) return "Time to come";
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};
const getToken = (url: string | null) => {
  if (!url) return "";
  try {
    return decodeURIComponent(
      url.match(/(?:\/|\?)join\/([^/?#]+)/)?.[1] ||
        url.match(/[?&]invite=([^&#]+)/)?.[1] ||
        "",
    );
  } catch {
    return "";
  }
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedCrewroom />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedCrewroom() {
  const { resolved } = useUI();
  return <>
    <StatusBar style={resolved === "dark" ? "light" : "dark"} />
    <Crewroom />
  </>;
}

function Crewroom() {
  const { C, s, resolved } = useUI();
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [publicRoute, setPublicRoute] = useState<{ page: PublicPage; token?: string } | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const generation = useRef(0);
  const [mode, setMode] = useState<"social" | "planning">("social");
  const [socialRoute, setSocialRoute] = useState<SocialRoute | null>(null);
  const [socialHomeVersion, setSocialHomeVersion] = useState(0);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [session, setSession] = useState<Session | null>(null),
    [data, setData] = useState<Workspace>(blank),
    [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState("");
  const [ownProfile, setOwnProfile] = useState<CreatorProfile | null>(null);
  const [ownProfileRevision, setOwnProfileRevision] = useState(0);
  const ownAvatar = ownProfile?.userId === session?.user?.id ? ownProfile?.avatar : null;
  useEffect(() => {
    let active = true;
    setOwnProfile(null);
    if (session?.user) {
      void socialApi.getMe().then(profile => {
        if (active) setOwnProfile(profile);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [session?.user?.id, session?.user?.isDemo, ownProfileRevision]);
  const [tab, setTab] = useState<Tab>("Today"),
    [crewId, setCrewId] = useState(""),
    [projectId, setProjectId] = useState(""),
    [projectTab, setProjectTab] = useState<ProjectTab>("Overview");
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [form, setForm] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [refreshing, setRefreshing] = useState(false);
  const [invite, setInvite] = useState<CreatedInvite | null>(null),
    [joinToken, setJoinToken] = useState(""),
    [joinPreview, setJoinPreview] = useState<
      (InvitePreview & { token: string }) | null
    >(null),
    [joinReload, setJoinReload] = useState(0);
  const crew = data.crews.find((c) => c.id === crewId) || data.crews[0];
  const project = data.projects.find((p) => p.id === projectId);
  const members = data.members.filter(
    (m) => m.crewId === (project?.crewId || crew?.id),
  );
  const owner =
    data.crews.find((c) => c.id === (project?.crewId || crew?.id))?.ownerId ===
    session?.user?.id;
  const projects = [...data.projects].sort((a, b) =>
    (a.date || "9999").localeCompare(b.date || "9999"),
  );
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const upcoming =
    projects.find((p) => p.date >= localDate) || projects.find((p) => !p.date);
  const displayProject = upcoming || projects[0];
  const tasks = data.tasks.filter((t) => t.projectId === project?.id);
  const lineup = data.lineup.filter((l) => l.projectId === project?.id);
  const agenda = data.agenda
    .filter((a) => a.projectId === project?.id)
    .sort((a, b) => a.time.localeCompare(b.time));
  const notify = (message: string) => setToast(message);
  const showPublicPage = (page: PublicPage) => {
    setPublicRoute({ page });
    setDialog(null);
    if (Platform.OS === "web") window.history.pushState(null, "", `/${page}`);
  };
  const leavePublicPage = () => {
    setPublicRoute(null);
    if (Platform.OS === "web") window.history.pushState(null, "", "/");
  };
  const clearDeletedAccount = () => {
    generation.current++;
    setSession(null); setData(blank); setCrewId(""); setProjectId("");
    setMode("social"); setSocialRoute(null); setSocialHomeVersion((v) => v + 1);
    leavePublicPage();
    notify("Your account has been deleted.");
  };
  const load = async () => {
    const version = generation.current;
    const next = await api.getWorkspace();
    if (version === generation.current) setData(next);
    return next;
  };
  const boot = async () => {
    setLoading(true);
    setFatal("");
    try {
      const [next, config] = await Promise.all([api.getSession(), api.getPublicConfig()]);
      setPublicConfig(config);
      setSession(next);
      if (next.user) await load();
      else setData(blank);
    } catch (e) {
      setFatal((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const receive = (url: string | null) => {
      const publicPage = parsePublicPage(url);
      setPublicRoute(publicPage);
      if (publicPage?.token && Platform.OS === "web") {
        // Keep the one-use token in memory, out of browser history and copied URLs.
        window.history.replaceState(null, "", `/${publicPage.page}`);
      }
      const token = getToken(url);
      if (token) setJoinToken(token);
      const route = readSocialRoute(url);
      setSocialRoute(route);
      if (route) setMode("social");
    };
    void Linking.getInitialURL()
      .then(receive)
      .catch(() => {})
      .finally(() => void boot());
    const listener = Linking.addEventListener("url", ({ url }) => receive(url));
    const browserBack = () =>
      receive(typeof window !== "undefined" ? window.location.href : null);
    if (Platform.OS === "web") window.addEventListener("popstate", browserBack);
    return () => {
      listener.remove();
      if (Platform.OS === "web")
        window.removeEventListener("popstate", browserBack);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!joinToken || loading) return;
    let active = true;
    setError("");
    setJoinPreview(null);
    setDialog({ kind: "join", title: "You’re invited" });
    void api
      .getInvite(joinToken)
      .then((preview) => {
        if (active) setJoinPreview({ ...preview, token: joinToken });
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [joinToken, loading, joinReload]);
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (dialog) {
        if (!busy) setDialog(null);
        return true;
      }
      if (publicRoute) { leavePublicPage(); return true; }
      if (mode === "social") return false;
      if (projectId) {
        setProjectId("");
        return true;
      }
      if (tab !== "Today") {
        setTab("Today");
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [dialog, projectId, tab, busy, mode, publicRoute]);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const open = (
    kind: Dialog["kind"],
    title: string,
    values: Record<string, string> = {},
    extras: Partial<Dialog> = {},
  ) => {
    setForm(values);
    setError("");
    setInvite(null);
    setDialog({ kind, title, ...extras });
    if (kind === "join" && joinToken) setJoinReload((n) => n + 1);
  };
  const change = (key: string) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const visit = (p: Project) => {
    setMode("planning");
    setProjectId(p.id);
    setCrewId(p.crewId);
    setProjectTab("Overview");
  };
  const navigate = (next: Tab) => {
    if (publicRoute) leavePublicPage();
    if (!session?.user) {
      open("signup", "Join your creative community");
      return;
    }
    setMode("planning");
    setTab(next);
    setProjectId("");
  };
  const clearSocialRoute = () => {
    setSocialRoute(null);
    if (Platform.OS === "web" && readSocialRoute(window.location.href))
      window.history.replaceState({}, "", "/");
  };
  const openSocial = () => {
    if (publicRoute) leavePublicPage();
    clearSocialRoute();
    setSocialHomeVersion((value) => value + 1);
    setProjectId("");
    setMode("social");
  };
  const openCrews = async () => {
    if (busy) return;
    if (publicRoute) leavePublicPage();
    setBusy(true);
    try {
      if (!session?.user) {
        const next = await api.startDemo();
        generation.current++;
        setSession(next);
      }
      await load();
      setProjectId("");
      setTab("Crews");
      setMode("planning");
      clearSocialRoute();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openSharedProject = async (id: string) => {
    try {
      const next = await load();
      const found = next.projects.find((p) => p.id === id);
      if (!found) {
        notify("This plan is no longer available to your account.");
        return;
      }
      visit(found);
      clearSocialRoute();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const mutate = async (action: () => Promise<unknown>, message?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await load();
      if (message) notify(message);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    let signedOut = false;
    try {
      await api.logout();
      signedOut = true;
      generation.current++;
      setSession(null);
      setData(blank);
      setCrewId("");
      setProjectId("");
      setMode("social");
      clearSocialRoute();
      notify("You’re signed out.");
    } catch (e) {
      if (signedOut || Platform.OS !== "web") {
        generation.current++;
        setSession(null);
        setData(blank);
        setCrewId("");
        setProjectId("");
        setFatal((e as Error).message);
      } else notify((e as Error).message);
    } finally {
      setLoading(false);
      setBusy(false);
    }
  };
  const newProject = () =>
    crew
      ? open("project", "Plan something", {
          crewId: crew.id,
          date: "",
          time: "",
          title: "",
          fandom: "",
          eventName: "",
          location: "",
          description: "",
        })
      : open("crew", "Start your crew");
  const startInvite = async (member?: Member) => {
    if (!crew) return;
    open("invite", member ? `Invite ${member.name}` : "Invite someone");
    setBusy(true);
    try {
      setInvite(
        await api.createInvite(crew.id, member ? { memberId: member.id } : {}),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (busy || !dialog) return;
    setBusy(true);
    setError("");
    try {
      switch (dialog.kind) {
        case "crew": {
          const next = await api.createCrew({
            name: form.name || "",
            description: form.description || "",
            color: C.pale,
          });
          setCrewId(next.id);
          setTab("Crews");
          setProjectId("");
          break;
        }
        case "project":
        case "editProject": {
          const input = {
            title: form.title || "",
            fandom: form.fandom || "",
            eventName: form.eventName || "",
            date: form.date || "",
            time: form.time || "",
            location: form.location || "",
            description: form.description || "",
          };
          if (dialog.kind === "editProject")
            await api.updateProject(dialog.id!, input);
          else {
            const next = await api.createProject({
              ...input,
              crewId: form.crewId || crew!.id,
            });
            visit(next);
          }
          break;
        }
        case "member":
          await api.createMember({
            crewId: crew!.id,
            name: form.name || "",
            role: form.role || "Cosplayer",
            color: colors[data.members.length % colors.length],
          });
          break;
        case "lineup":
          await api.createLineup({
            projectId: project!.id,
            memberId: dialog.member!.id,
            character: form.character || "",
            status: (form.status || "planning") as ReadinessStatus,
          });
          break;
        case "task":
          await api.createTask({
            projectId: project!.id,
            title: form.title || "",
            assigneeId: form.assigneeId || null,
            dueDate: form.dueDate || null,
          });
          break;
        case "agenda":
          await api.createAgenda({
            projectId: project!.id,
            title: form.title || "",
            time: form.time || "",
            location: form.location || "",
            notes: form.notes || "",
          });
          break;
        case "removeMember":
          await api.deleteMember(dialog.member!.id);
          break;
        case "signup":
        case "login": {
          const next =
            dialog.kind === "signup"
              ? await api.signup({
                  name: form.name || "",
                  email: form.email || "",
                  password: form.password || "",
                  policyAccepted: form.policyAccepted === "yes",
                  ageConfirmed: form.ageConfirmed === "yes",
                  policyVersion: publicConfig?.policyVersion,
                })
              : await api.login({
                  email: form.email || "",
                  password: form.password || "",
                });
          generation.current++;
          setData(blank);
          setSession(next);
          setCrewId("");
          setProjectId("");
          try {
            await load();
          } catch (e) {
            notify(`Signed in. ${(e as Error).message}`);
          }
          if (joinToken) {
            setDialog({ kind: "join", title: "You’re invited" });
            return;
          }
          notify(
            dialog.kind === "signup"
              ? "Your workspace is saved to your account."
              : "Welcome back.",
          );
          break;
        }
        case "join": {
          if (joinPreview?.token !== joinToken)
            throw new Error(
              "Wait for this invitation to load, then try again.",
            );
          const joined = await api.acceptInvite(joinToken);
          setMode("planning");
          setCrewId(joined.crewId);
          setTab("Crews");
          setProjectId("");
          setJoinToken("");
          setJoinPreview(null);
          if (Platform.OS === "web" && typeof window !== "undefined")
            window.history.replaceState({}, "", "/");
          notify("You’re in. Welcome to the crew.");
          break;
        }
      }
      setDialog(null);
      try {
        await load();
      } catch (e) {
        notify(`Saved. ${(e as Error).message}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const taskRow = (task: Task, showProject = false) => (
    <View key={task.id} style={s.taskRow}>
      <Pressable
        accessibilityRole="checkbox"
        hitSlop={9}
        accessibilityState={{ checked: task.done, disabled: busy }}
        aria-checked={task.done}
        accessibilityLabel={`Complete ${task.title}`}
        disabled={busy}
        onPress={() =>
          void mutate(() => api.updateTask(task.id, { done: !task.done }))
        }
        style={[s.checkbox, task.done && s.checked]}
      >
        {task.done && <Icon name="checkmark" size={17} color={C.onAccent} />}
      </Pressable>
      <View style={s.grow}>
        <Text style={[s.taskTitle, task.done && s.doneText]}>{task.title}</Text>
        <Text style={s.small}>
          {showProject
            ? data.projects.find((p) => p.id === task.projectId)?.title
            : data.members.find((m) => m.id === task.assigneeId)?.name ||
              "Anyone on the crew"}
          {task.dueDate
            ? ` · ${dateParts(task.dueDate).month} ${dateParts(task.dueDate).day}`
            : ""}
        </Text>
      </View>
      {!showProject && (
        <IconButton
          label={`Delete ${task.title}`}
          name="close-outline"
          color={C.muted}
          onPress={() => void mutate(() => api.deleteTask(task.id))}
        />
      )}
    </View>
  );
  const projectCard = (p: Project) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${p.title}`}
      key={p.id}
      onPress={() => visit(p)}
      style={[s.card, { gap: 14 }]}
    >
      <View style={s.row}>
        <View style={s.dateBox}>
          <Text style={s.dateMonth}>{dateParts(p.date).month}</Text>
          <Text style={s.dateDay}>{dateParts(p.date).day}</Text>
        </View>
        <View style={[s.grow, { gap: 4 }]}>
          <Text style={s.h3}>{p.title}</Text>
          <Text style={s.small}>
            {p.eventName || p.fandom || "A new adventure"}
          </Text>
        </View>
        <Icon name="chevron-forward" size={18} color={C.muted} />
      </View>
      <View style={s.divider} />
      <View style={s.between}>
        <View style={[s.row, { gap: 6, flex: 1 }]}>
          <Icon name="location-outline" size={14} color={C.muted} />
          <Text numberOfLines={1} style={s.small}>
            {p.location || "Location to come"}
          </Text>
        </View>
        <Text style={s.small}>{p.time ? clock(p.time) : "Time to come"}</Text>
      </View>
    </Pressable>
  );
  const projectForm = (
    <>
      <Field
        label="Project name"
        value={form.title || ""}
        onChange={change("title")}
        placeholder="The skybound crew"
      />
      <Field
        label="Fandom or theme"
        value={form.fandom || ""}
        onChange={change("fandom")}
        placeholder="Original characters, your favorite series…"
      />
      <Field
        label="Convention or shoot"
        value={form.eventName || ""}
        onChange={change("eventName")}
        placeholder="Saturday studio shoot"
      />
      <View style={s.row}>
        <View style={s.grow}>
          <Field
            label="Date (YYYY-MM-DD)"
            value={form.date || ""}
            onChange={change("date")}
            placeholder="2026-10-24"
          />
        </View>
        <View style={s.grow}>
          <Field
            label="Time (24-hour)"
            value={form.time || ""}
            onChange={change("time")}
            placeholder="14:00"
          />
        </View>
      </View>
      <Field
        label="Meeting location"
        value={form.location || ""}
        onChange={change("location")}
        placeholder="Studio name, entrance, or landmark"
      />
      <Field
        label="Notes for the crew"
        value={form.description || ""}
        onChange={change("description")}
        multiline
        placeholder="The vibe, what to bring, and anything to know."
      />
    </>
  );

  if (loading)
    return (
      <View style={s.root}>
        <Loading />
      </View>
    );
  if (fatal && !publicRoute)
    return (
      <View style={s.root}>
        <View style={s.center}>
          <Icon name="cloud-offline-outline" size={38} color={C.blue} />
          <Text style={s.h2}>Let’s get you connected</Text>
          <Text style={[s.body, { textAlign: "center" }]}>{fatal}</Text>
          <Button title="Try again" onPress={() => void boot()} />
          <Text style={[s.small, { textAlign: "center" }]}>
            {__DEV__ ? `Crewroom development · ${getApiBaseUrl()}` : "Crewroom needs an internet connection."}
          </Text>
        </View>
      </View>
    );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.app}>
        <View style={[s.topbar, !wide && { paddingHorizontal: 16, gap: 4 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Crewroom home"
            onPress={openSocial}
            style={s.brandRow}
          >
            <Text
              style={[
                s.brand,
                !wide && { fontSize: 28 },
                width < 360 && { fontSize: 24 },
              ]}
            >
              crewroom<Text style={s.brandDot}>.</Text>
            </Text>
          </Pressable>
          <View style={[s.row, { gap: 5 }]}>
            <IconButton
              name={resolved === "dark" ? "moon-outline" : "sunny-outline"}
              label="Appearance settings"
              onPress={() => setAppearanceOpen(true)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                mode === "social"
                  ? "My private crews"
                  : "Discover creative work"
              }
              onPress={() =>
                mode === "social" ? void openCrews() : openSocial()
              }
              style={({ pressed }) => [
                s.headerAction,
                { minWidth: 44 },
                pressed && { opacity: 0.65 },
              ]}
            >
              <Icon
                name={mode === "social" ? "people-outline" : "compass-outline"}
                size={17}
                color={C.violet}
              />
              {width >= 360 && (
                <Text style={s.headerActionText}>
                  {mode === "social" ? "Crews" : "Home"}
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Your account"
              onPress={() => navigate("You")}
              style={s.headerAccount}
            >
              <Avatar
                name={session?.user?.name || "You"}
                source={ownAvatar ? mediaSource(ownAvatar) : undefined}
                size={34}
                color={C.lavender}
              />
            </Pressable>
          </View>
        </View>
        {publicRoute ? (
          <ScrollView key={publicRoute.page} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, paddingBottom: Math.max(insets.bottom, 24), width: "100%", maxWidth: 740, alignSelf: "center", gap: 24 }}>
            <Button title="Back to Crewroom" secondary onPress={leavePublicPage} />
            <PublicPageContent page={publicRoute.page} config={publicConfig} onOpen={showPublicPage}>
              {publicRoute.page === "delete-account" ? <AccountCenter key={session?.user?.id || "visitor"} user={session?.user || null} config={publicConfig} onDeleted={clearDeletedAccount} onSignIn={() => open("login", "Sign in to your account")} /> : publicRoute.page === "reset-password" ? <PasswordRecovery token={publicRoute.token} config={publicConfig} onReset={() => { generation.current++; setSession(null); setData(blank); setProjectId(""); setCrewId(""); }} onSignIn={() => { leavePublicPage(); open("login", "Welcome back"); }} /> : null}
            </PublicPageContent>
          </ScrollView>
        ) : mode === "social" ? (
          <>
            {session?.user?.isDemo && (
              <View style={[s.demo, { marginHorizontal: 24, marginBottom: 8 }]}>
                <Text style={s.small}>Your private demo</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => open("signup", "Make it yours")}
                >
                  <Text style={s.link}>Save with an account →</Text>
                </Pressable>
              </View>
            )}
            {!!joinToken && dialog?.kind !== "join" && (
              <Button
                title="View crew invitation"
                secondary
                onPress={() => open("join", "You’re invited")}
              />
            )}
            <SocialExperience
              key={`${session?.user?.id || "visitor"}:${session?.user?.isDemo || false}:${socialHomeVersion}`}
              user={session?.user || null}
              playbackSuspended={!!dialog || appearanceOpen}
              onRequireAccount={() =>
                open("signup", "Join your creative community")
              }
              onOpenProject={(id) => void openSharedProject(id)}
              onOpenCrews={() => void openCrews()}
              initialRoute={socialRoute}
              onClearRoute={clearSocialRoute}
              onAccountSettings={() => showPublicPage("delete-account")}
              onProfileChanged={() => setOwnProfileRevision(value => value + 1)}
            />
          </>
        ) : (
          <>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[
                s.content,
                wide && { paddingHorizontal: 32, paddingTop: 8 },
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => void refresh()}
                  tintColor={C.blue}
                />
              }
              keyboardShouldPersistTaps="handled"
            >
              {session?.user?.isDemo && (
                <View style={s.demo}>
                  <View style={[s.row, { gap: 7 }]}>
                    <Icon name="flask-outline" size={15} color={C.muted} />
                    <Text style={s.small}>Your private demo</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => open("signup", "Make it yours")}
                  >
                    <Text style={s.link}>Save with an account →</Text>
                  </Pressable>
                </View>
              )}
              {!!joinToken && dialog?.kind !== "join" && (
                <Button
                  title="View your crew invitation"
                  secondary
                  onPress={() => open("join", "You’re invited")}
                />
              )}
              {project ? (
                <>
                  <View style={s.between}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setProjectId("")}
                      style={s.row}
                    >
                      <Icon name="arrow-back" size={18} />
                      <Text style={s.link}>Your plans</Text>
                    </Pressable>
                    {
                      <IconButton
                        name="create-outline"
                        label="Edit project"
                        onPress={() =>
                          open(
                            "editProject",
                            "Edit your plan",
                            {
                              title: project.title,
                              fandom: project.fandom,
                              eventName: project.eventName,
                              date: project.date,
                              time: project.time,
                              location: project.location,
                              description: project.description,
                            },
                            { id: project.id },
                          )
                        }
                      />
                    }
                  </View>
                  <View style={{ gap: 9 }}>
                    <Text style={s.eyebrow}>
                      {project.fandom || "Made together"}
                    </Text>
                    <Text style={s.h1}>{project.title}</Text>
                    <Text style={s.body}>
                      {project.eventName ||
                        data.crews.find((c) => c.id === project.crewId)?.name}
                    </Text>
                  </View>
                  <View style={s.tabs}>
                    {(
                      [
                        "Overview",
                        "Lineup",
                        "Checklist",
                        "Day plan",
                      ] as ProjectTab[]
                    ).map((t) => (
                      <Pressable
                        key={t}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: projectTab === t }}
                        aria-selected={projectTab === t}
                        onPress={() => setProjectTab(t)}
                        style={[s.tab, projectTab === t && s.tabActive]}
                      >
                        <Text
                          style={[
                            s.tabText,
                            projectTab === t && { color: C.ink },
                          ]}
                        >
                          {t}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {projectTab === "Overview" && (
                    <>
                      <View style={s.card}>
                        <View style={s.row}>
                          <View style={s.dateBox}>
                            <Text style={s.dateMonth}>
                              {dateParts(project.date).month}
                            </Text>
                            <Text style={s.dateDay}>
                              {dateParts(project.date).day}
                            </Text>
                          </View>
                          <View style={[s.grow, { gap: 5 }]}>
                            <Text style={s.h3}>
                              {dateParts(project.date).full}
                            </Text>
                            <Text style={s.body}>{clock(project.time)}</Text>
                          </View>
                          <Icon name="calendar-outline" color={C.blue} />
                        </View>
                        <View style={s.divider} />
                        <View style={s.row}>
                          <Icon name="location-outline" color={C.blue} />
                          <Text style={[s.body, { flex: 1, color: C.ink }]}>
                            {project.location ||
                              "Add a meeting spot so everyone knows where to go."}
                          </Text>
                        </View>
                      </View>
                      {project.description ? (
                        <View style={s.card}>
                          <Text style={s.eyebrow}>The plan</Text>
                          <Text style={[s.body, { color: C.ink }]}>
                            {project.description}
                          </Text>
                        </View>
                      ) : null}
                      <View style={s.stats}>
                        <View style={s.stat}>
                          <Text style={s.statValue}>
                            {lineup.filter((l) => l.status === "ready").length}
                            <Text style={{ fontSize: 15, color: C.muted }}>
                              {" "}
                              / {lineup.length}
                            </Text>
                          </Text>
                          <Text style={s.statLabel}>cosplays ready</Text>
                        </View>
                        <View style={s.stat}>
                          <Text style={s.statValue}>
                            {tasks.filter((t) => t.done).length}
                            <Text style={{ fontSize: 15, color: C.muted }}>
                              {" "}
                              / {tasks.length}
                            </Text>
                          </Text>
                          <Text style={s.statLabel}>tasks complete</Text>
                        </View>
                        <View style={s.stat}>
                          <Text style={s.statValue}>{agenda.length}</Text>
                          <Text style={s.statLabel}>day plan moments</Text>
                        </View>
                      </View>
                      <View>
                        <Heading
                          title="Before you head out"
                          action="Checklist"
                          onPress={() => setProjectTab("Checklist")}
                        />
                        <View style={s.card}>
                          {tasks.length ? (
                            tasks.slice(0, 3).map((t) => taskRow(t))
                          ) : (
                            <Text style={s.body}>
                              A little preparation goes a long way. Add the
                              first task.
                            </Text>
                          )}
                        </View>
                      </View>
                    </>
                  )}
                  {projectTab === "Lineup" && (
                    <>
                      <View style={{ gap: 6 }}>
                        <Text style={s.h2}>Every character. One crew.</Text>
                        <Text style={s.body}>
                          Characters and progress for this plan.
                        </Text>
                      </View>
                      {members.map((member) => {
                        const item = lineup.find(
                          (l) => l.memberId === member.id,
                        );
                        const canEdit =
                          owner || member.userId === session?.user?.id;
                        return (
                          <View key={member.id} style={s.card}>
                            <View style={s.row}>
                              <Avatar name={member.name} color={member.color} />
                              <View style={s.grow}>
                                <Text style={s.h3}>{member.name}</Text>
                                <Text style={s.small}>
                                  {member.role}
                                  {member.isPlaceholder
                                    ? " · Planned member"
                                    : ""}
                                </Text>
                              </View>
                              {canEdit && (
                                <IconButton
                                  label={`Edit ${member.name} lineup`}
                                  name="create-outline"
                                  onPress={() =>
                                    open(
                                      "lineup",
                                      member.userId === session?.user?.id
                                        ? "Your cosplay"
                                        : `${member.name}’s cosplay`,
                                      {
                                        character: item?.character || "",
                                        status: item?.status || "planning",
                                      },
                                      { member },
                                    )
                                  }
                                />
                              )}
                            </View>
                            <View style={s.between}>
                              <Text style={[s.body, { color: C.ink, flex: 1 }]}>
                                {item?.character || "Character to come"}
                              </Text>
                              <Tag
                                tone={
                                  item?.status === "ready"
                                    ? "green"
                                    : item?.status === "making"
                                      ? "orange"
                                      : "muted"
                                }
                              >
                                {item?.status === "ready"
                                  ? "Ready to go"
                                  : item?.status === "making"
                                    ? "In the making"
                                    : "Planning"}
                              </Tag>
                            </View>
                          </View>
                        );
                      })}
                      {!members.length && (
                        <Empty
                          title="Build the lineup"
                          text="Add people to your crew, then choose their characters."
                        />
                      )}
                    </>
                  )}
                  {projectTab === "Checklist" && (
                    <>
                      <Heading
                        title="A little closer to ready"
                        action="Add task"
                        onPress={() => open("task", "One less thing to forget")}
                      />
                      <View style={s.card}>
                        <View style={s.between}>
                          <Text style={s.body}>
                            {tasks.filter((t) => t.done).length} of{" "}
                            {tasks.length} complete
                          </Text>
                          <Text style={s.link}>
                            {tasks.length
                              ? Math.round(
                                  (tasks.filter((t) => t.done).length /
                                    tasks.length) *
                                    100,
                                )
                              : 0}
                            %
                          </Text>
                        </View>
                        <View style={s.progressTrack}>
                          <View
                            style={[
                              s.progressBar,
                              {
                                width: `${tasks.length ? (tasks.filter((t) => t.done).length / tasks.length) * 100 : 0}%`,
                              },
                            ]}
                          />
                        </View>
                        {tasks.length ? (
                          tasks.map((t) => taskRow(t))
                        ) : (
                          <Empty
                            icon="checkmark-circle-outline"
                            title="Start with the essentials"
                            text="Finish the wig. Pack the repair kit. Charge the camera."
                            action="Add your first task"
                            onPress={() =>
                              open("task", "One less thing to forget")
                            }
                          />
                        )}
                      </View>
                    </>
                  )}
                  {projectTab === "Day plan" && (
                    <>
                      <Heading
                        title="Make the most of the day"
                        action="Add moment"
                        onPress={() => open("agenda", "Add to the day plan")}
                      />
                      {agenda.length ? (
                        <View style={s.card}>
                          {agenda.map((item, i) => (
                            <View
                              key={item.id}
                              style={[s.row, { alignItems: "flex-start" }]}
                            >
                              <View
                                style={{
                                  width: 63,
                                  paddingTop: 4,
                                  gap: 12,
                                  alignItems: "center",
                                }}
                              >
                                <Text style={[s.link, { fontSize: 11 }]}>
                                  {clock(item.time)}
                                </Text>
                                {i < agenda.length - 1 && (
                                  <View
                                    style={{
                                      width: 2,
                                      height: 42,
                                      backgroundColor: C.pale,
                                    }}
                                  />
                                )}
                              </View>
                              <View
                                style={[
                                  s.grow,
                                  { paddingTop: 2, gap: 4, paddingBottom: 16 },
                                ]}
                              >
                                <Text style={s.h3}>{item.title}</Text>
                                {item.location ? (
                                  <Text style={s.small}>{item.location}</Text>
                                ) : null}
                                {item.notes ? (
                                  <Text style={s.body}>{item.notes}</Text>
                                ) : null}
                              </View>
                              <IconButton
                                label={`Delete ${item.title}`}
                                name="close-outline"
                                color={C.muted}
                                onPress={() =>
                                  void mutate(() => api.deleteAgenda(item.id))
                                }
                              />
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Empty
                          icon="time-outline"
                          title="Less scrambling. More shooting."
                          text="Give everyone one place to find meetups, shoot times, and breaks."
                          action="Plan the first moment"
                          onPress={() => open("agenda", "Add to the day plan")}
                        />
                      )}
                    </>
                  )}
                </>
              ) : tab === "Today" ? (
                <>
                  <View style={{ gap: 8 }}>
                    <Text style={s.eyebrow}>
                      Your people. Your next adventure.
                    </Text>
                    <Text style={s.h1}>
                      Good things happen{wide ? " " : "\n"}with your crew.
                    </Text>
                    <Text style={s.body}>
                      A little planning. A lot of making memories.
                    </Text>
                  </View>
                  <View style={[wide && { flexDirection: "row", gap: 24 }]}>
                    <View style={[{ gap: 20 }, wide && { flex: 1.15 }]}>
                      {displayProject ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open featured ${displayProject.title}`}
                          onPress={() => visit(displayProject)}
                          style={s.hero}
                        >
                          <Text style={s.heroLabel}>
                            {upcoming
                              ? "UP NEXT, TOGETHER"
                              : "YOUR LATEST PLAN"}
                          </Text>
                          <Text style={[s.heroTitle, { maxWidth: "72%" }]}>
                            {displayProject.title}
                          </Text>
                          <Text
                            style={{
                              fontSize: 12,
                              color: "#D8E3FF",
                              maxWidth: "70%",
                            }}
                          >
                            {displayProject.eventName || displayProject.fandom}
                          </Text>
                          <View style={s.heroArt} pointerEvents="none">
                            <View
                              style={[
                                s.artCard,
                                {
                                  backgroundColor: "#B5C8FC",
                                  right: 2,
                                  top: 17,
                                  transform: [{ rotate: "15deg" }],
                                },
                              ]}
                            >
                              <Icon name="sparkles" color={C.onAccent} size={38} />
                              <View
                                style={{
                                  height: 4,
                                  width: 36,
                                  backgroundColor: "#EDF1FF",
                                  borderRadius: 4,
                                }}
                              />
                            </View>
                            <View
                              style={[
                                s.artCard,
                                {
                                  backgroundColor: "#F6D9C7",
                                  left: 0,
                                  top: 45,
                                  transform: [{ rotate: "-12deg" }],
                                },
                              ]}
                            >
                              <Icon
                                name="planet-outline"
                                color="#17283B"
                                size={38}
                              />
                              <Text
                                style={{
                                  fontSize: 9,
                                  fontWeight: "800",
                                  color: "#17283B",
                                  letterSpacing: 1,
                                }}
                              >
                                LET’S MAKE IT
                              </Text>
                            </View>
                          </View>
                          <View style={[s.heroButton, { marginTop: 5 }]}>
                            <Text style={s.link}>Open project</Text>
                            <Icon
                              name="arrow-forward"
                              size={17}
                              color={C.blue}
                            />
                          </View>
                        </Pressable>
                      ) : (
                        <Empty
                          title="Your next adventure starts here"
                          text="Bring your people together around a shoot, a convention, or a project."
                          action={crew ? "Plan something" : "Start your crew"}
                          onPress={newProject}
                        />
                      )}
                      <View style={s.stats}>
                        <View style={s.stat}>
                          <Text style={s.statValue}>
                            {data.crews.length.toString().padStart(2, "0")}
                          </Text>
                          <Text style={s.statLabel}>your crews</Text>
                        </View>
                        <View style={s.stat}>
                          <Text style={s.statValue}>
                            {data.projects
                              .filter((p) => !p.date || p.date >= localDate)
                              .length.toString()
                              .padStart(2, "0")}
                          </Text>
                          <Text style={s.statLabel}>upcoming plans</Text>
                        </View>
                        <View style={s.stat}>
                          <Text style={s.statValue}>
                            {data.tasks
                              .filter((t) => !t.done)
                              .length.toString()
                              .padStart(2, "0")}
                          </Text>
                          <Text style={s.statLabel}>things to do</Text>
                        </View>
                      </View>
                    </View>
                    <View
                      style={[
                        { gap: 22, marginTop: wide ? 0 : 25 },
                        wide && { flex: 1 },
                      ]}
                    >
                      <View>
                        <Heading
                          title="On the calendar"
                          action="Plan something"
                          onPress={newProject}
                        />
                        {displayProject ? (
                          projectCard(displayProject)
                        ) : (
                          <Text style={s.body}>Room for something good.</Text>
                        )}
                      </View>
                      <View>
                        <Heading
                          title="Small steps, big payoff"
                          action="All plans"
                          onPress={() => navigate("Plans")}
                        />
                        <View style={s.card}>
                          {data.tasks
                            .filter((t) => !t.done)
                            .slice(0, 3)
                            .map((t) => taskRow(t, true))}
                          {!data.tasks.some((t) => !t.done) && (
                            <Text style={s.body}>
                              You’re all caught up. Enjoy the making.
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>
                  </View>
                  <View
                    style={[
                      s.row,
                      { justifyContent: "center", paddingVertical: 5 },
                    ]}
                  >
                    <Icon name="sparkles-outline" color={C.muted} size={14} />
                    <Text style={s.small}>
                      Made for the people who make things.
                    </Text>
                  </View>
                </>
              ) : tab === "Crews" ? (
                <>
                  <View style={s.between}>
                    <View style={{ gap: 6 }}>
                      <Text style={s.eyebrow}>Better together</Text>
                      <Text style={s.h1}>Your people.</Text>
                    </View>
                    <IconButton
                      name="add"
                      label="Create a crew"
                      onPress={() => open("crew", "Start your crew")}
                    />
                  </View>
                  {!!data.crews.length && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={s.chips}
                    >
                      {data.crews.map((c) => (
                        <Pressable
                          accessibilityRole="button"
                          key={c.id}
                          onPress={() => setCrewId(c.id)}
                          style={[s.chip, c.id === crew?.id && s.chipActive]}
                        >
                          <Text style={s.chipText}>{c.name}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                  {crew ? (
                    <>
                      <View
                        style={[
                          s.card,
                          { backgroundColor: C.pale, borderColor: C.pale },
                        ]}
                      >
                        <View style={s.between}>
                          <Icon
                            name="people-outline"
                            color={C.blue}
                            size={27}
                          />
                          <Tag>
                            {
                              data.members.filter((m) => m.crewId === crew.id)
                                .length
                            }{" "}
                            people
                          </Tag>
                        </View>
                        <Text style={s.h2}>{crew.name}</Text>
                        {crew.description ? (
                          <Text style={s.body}>{crew.description}</Text>
                        ) : null}
                        {owner && (
                          <Button
                            title="Invite someone"
                            icon="person-add-outline"
                            onPress={() => void startInvite()}
                          />
                        )}
                      </View>
                      <View>
                        <Heading
                          title="The crew"
                          action={owner ? "Add planned member" : undefined}
                          onPress={() =>
                            open("member", "Make room for someone")
                          }
                        />
                        <View style={s.card}>
                          {members.map((m, i) => (
                            <View key={m.id} style={{ gap: 15 }}>
                              {i > 0 && <View style={s.divider} />}
                              <View style={s.row}>
                                <Avatar name={m.name} color={m.color} />
                                <View style={s.grow}>
                                  <Text style={s.h3}>
                                    {m.name}
                                    {m.userId === session?.user?.id
                                      ? " (you)"
                                      : ""}
                                  </Text>
                                  <Text style={s.small}>
                                    {m.role}
                                    {m.isPlaceholder ? " · Planned member" : ""}
                                  </Text>
                                </View>
                                {owner && m.isPlaceholder && (
                                  <IconButton
                                    label={`Invite ${m.name}`}
                                    name="paper-plane-outline"
                                    color={C.blue}
                                    onPress={() => void startInvite(m)}
                                  />
                                )}
                                {m.userId !== crew.ownerId &&
                                  (owner || m.userId === session?.user?.id) && (
                                    <IconButton
                                      label={`Remove ${m.name}`}
                                      name="close-outline"
                                      color={C.muted}
                                      onPress={() =>
                                        open(
                                          "removeMember",
                                          m.userId === session?.user?.id
                                            ? "Leave this crew?"
                                            : `Remove ${m.name}?`,
                                          {},
                                          { member: m },
                                        )
                                      }
                                    />
                                  )}
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                      <View>
                        <Heading
                          title="What you’re making"
                          action="New plan"
                          onPress={newProject}
                        />
                        <View style={s.column}>
                          {projects
                            .filter((p) => p.crewId === crew.id)
                            .map(projectCard)}
                          {!projects.some((p) => p.crewId === crew.id) && (
                            <Empty
                              title="Give the crew something to look forward to"
                              text="Start with one real shoot or convention."
                              action="Make a plan"
                              onPress={newProject}
                            />
                          )}
                        </View>
                      </View>
                    </>
                  ) : (
                    <Empty
                      icon="people-outline"
                      title="Find your kind of people"
                      text="Start a private crew for the friends you make, shoot, and go to conventions with."
                      action="Create your first crew"
                      onPress={() => open("crew", "Start your crew")}
                    />
                  )}
                </>
              ) : tab === "Plans" ? (
                <>
                  <View style={s.between}>
                    <View style={{ gap: 6 }}>
                      <Text style={s.eyebrow}>From idea to “we did that”</Text>
                      <Text style={s.h1}>In the making.</Text>
                    </View>
                    <IconButton
                      name="add"
                      label="Create a project"
                      onPress={newProject}
                    />
                  </View>
                  <Text style={s.body}>
                    Every shoot, convention, and wonderfully ambitious idea.
                  </Text>
                  <View
                    style={[
                      s.column,
                      wide && { flexDirection: "row", flexWrap: "wrap" },
                    ]}
                  >
                    {projects.map((p) => (
                      <View key={p.id} style={wide ? { width: "48%" } : {}}>
                        {projectCard(p)}
                      </View>
                    ))}
                    {!projects.length && (
                      <Empty
                        icon="calendar-outline"
                        title="Something to look forward to"
                        text="Put the date, the people, and all the little details in one place."
                        action="Plan something"
                        onPress={newProject}
                      />
                    )}
                  </View>
                </>
              ) : (
                <>
                  <View style={{ gap: 6 }}>
                    <Text style={s.eyebrow}>Behind the cosplay</Text>
                    <Text style={s.h1}>
                      Hey, {session?.user?.name.split(" ")[0]}.
                    </Text>
                  </View>
                  <View style={s.card}>
                    <View style={s.row}>
                      <Avatar
                        name={session?.user?.name || "You"}
                        source={ownAvatar ? mediaSource(ownAvatar) : undefined}
                        size={62}
                        color={C.peach}
                      />
                      <View style={s.grow}>
                        <Text style={s.h2}>{session?.user?.name}</Text>
                        <Text style={s.body}>
                          {session?.user?.isDemo
                            ? "Exploring Crewroom"
                            : session?.user?.email}
                        </Text>
                      </View>
                    </View>
                    {session?.user?.isDemo ? (
                      <>
                        <Text style={s.body}>
                          This sample workspace is just for you. Create an
                          account to keep your plans, then start a crew for your
                          own people.
                        </Text>
                        <Button
                          title="Create your account"
                          onPress={() => open("signup", "Make it yours")}
                        />
                        <Button
                          title="I already have an account"
                          secondary
                          onPress={() => open("login", "Welcome back")}
                        />
                      </>
                    ) : (
                      <Button
                        title="Sign out"
                        secondary
                        onPress={() => void signOut()}
                      />
                    )}
                  </View>
                  <View style={s.card}>
                    <AppearanceControl />
                  </View>
                  <Button title="Account & privacy" secondary icon="shield-checkmark-outline" onPress={() => showPublicPage("delete-account")} />
                  <PolicyLinks onOpen={showPublicPage} config={publicConfig} />
                  <View style={s.card}>
                    <Text style={s.h3}>Have an invitation?</Text>
                    <Text style={s.body}>
                      Open a crew link or paste it here to join from your phone.
                    </Text>
                    <Button
                      title="Enter an invite link"
                      secondary
                      icon="link-outline"
                      onPress={() => open("join", "Join your people")}
                    />
                  </View>
                  <View style={s.card}>
                    <Text style={s.h3}>Small crew. Big ideas.</Text>
                    <Text style={s.body}>
                      A creative community for showing what you make, finding
                      your people, and planning what comes next together.
                    </Text>
                    <View style={s.divider} />
                    <Text style={s.small}>
                      Plans save to the connected server. Pull down to refresh
                      changes from your crew. An internet or local network
                      connection is needed.
                    </Text>
                    <Text style={s.small}>Crewroom · Creative beta 0.3</Text>
                  </View>
                </>
              )}
            </ScrollView>
            <View
              style={[s.nav, { paddingBottom: Math.max(insets.bottom, 8) }]}
            >
              <Pressable
                accessibilityRole="tab"
                accessibilityLabel="Discover"
                onPress={openSocial}
                style={s.navItem}
              >
                <Icon name="compass-outline" size={21} color={C.muted} />
                <Text style={s.navText}>Discover</Text>
              </Pressable>
              {(
                [
                  { name: "Today", icon: "sunny-outline" },
                  { name: "Crews", icon: "people-outline" },
                  { name: "Plans", icon: "calendar-outline" },
                  { name: "You", icon: "person-outline" },
                ] as const
              ).map((item) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityLabel={item.name}
                  accessibilityState={{
                    selected: tab === item.name && !project,
                  }}
                  aria-selected={tab === item.name && !project}
                  key={item.name}
                  onPress={() => navigate(item.name)}
                  style={[
                    s.navItem,
                    tab === item.name && !project && s.navActive,
                  ]}
                >
                  <Icon
                    name={item.icon}
                    size={21}
                    color={tab === item.name && !project ? C.blue : C.muted}
                  />
                  <Text
                    style={[
                      s.navText,
                      tab === item.name && !project && { color: C.blue },
                    ]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {toast ? (
          <Pressable
            accessibilityRole="alert"
            onPress={() => setToast("")}
            style={s.toast}
          >
            <Icon name="information-circle-outline" color={C.onInverse} />
            <Text style={s.toastText}>{toast}</Text>
            <Icon name="close" size={16} color={C.onInverse} />
          </Pressable>
        ) : null}
      </View>
      <Modal
        visible={!!dialog}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!busy) setDialog(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={s.modalBackdrop}
        >
          <View style={[s.modal, { paddingBottom: insets.bottom }]}>
            <View style={s.modalHeader}>
              <Text style={[s.h2, { flex: 1 }]}>{dialog?.title}</Text>
              <IconButton
                name="close"
                label="Close dialog"
                onPress={() => {
                  if (!busy) setDialog(null);
                }}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.modalBody}
            >
              {error ? (
                <View accessibilityRole="alert" style={s.error}>
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}
              {dialog?.kind === "crew" && (
                <>
                  <Field
                    label="Crew name"
                    value={form.name || ""}
                    onChange={change("name")}
                    placeholder="The midnight makers"
                  />
                  <Field
                    label="A little about your crew"
                    value={form.description || ""}
                    onChange={change("description")}
                    multiline
                    placeholder="What brings you together?"
                  />
                </>
              )}
              {(dialog?.kind === "project" ||
                dialog?.kind === "editProject") && (
                <>
                  {dialog.kind === "project" && data.crews.length > 1 && (
                    <>
                      <Text style={s.fieldLabel}>Crew</Text>
                      <View style={s.chips}>
                        {data.crews.map((c) => (
                          <Pressable
                            key={c.id}
                            accessibilityRole="button"
                            style={[
                              s.chip,
                              form.crewId === c.id && s.chipActive,
                            ]}
                            onPress={() => change("crewId")(c.id)}
                          >
                            <Text style={s.chipText}>{c.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  )}
                  {projectForm}
                </>
              )}
              {dialog?.kind === "member" && (
                <>
                  <Text style={s.body}>
                    Plan a spot for someone. They’ll become a joined member when
                    they accept their personal invitation.
                  </Text>
                  <Field
                    label="Name"
                    value={form.name || ""}
                    onChange={change("name")}
                    placeholder="Their name"
                  />
                  <Field
                    label="Role"
                    value={form.role || ""}
                    onChange={change("role")}
                    placeholder="Cosplayer, photographer, maker…"
                  />
                </>
              )}
              {dialog?.kind === "lineup" && (
                <>
                  <Field
                    label="Character or cosplay"
                    value={form.character || ""}
                    onChange={change("character")}
                    placeholder="Who are you bringing to life?"
                  />
                  <Text style={s.fieldLabel}>How’s it coming along?</Text>
                  <View style={s.chips}>
                    {(["planning", "making", "ready"] as const).map(
                      (status) => (
                        <Pressable
                          key={status}
                          accessibilityRole="button"
                          onPress={() => change("status")(status)}
                          style={[
                            s.chip,
                            form.status === status && s.chipActive,
                          ]}
                        >
                          <Text style={s.chipText}>
                            {status === "planning"
                              ? "Planning"
                              : status === "making"
                                ? "In the making"
                                : "Ready to go"}
                          </Text>
                        </Pressable>
                      ),
                    )}
                  </View>
                </>
              )}
              {dialog?.kind === "task" && (
                <>
                  <Field
                    label="What needs doing?"
                    value={form.title || ""}
                    onChange={change("title")}
                    placeholder="Pack the emergency repair kit"
                  />
                  <Field
                    label="Due date (YYYY-MM-DD, optional)"
                    value={form.dueDate || ""}
                    onChange={change("dueDate")}
                    placeholder="2026-10-23"
                  />
                  <Text style={s.fieldLabel}>Who’s got this?</Text>
                  <View style={s.chips}>
                    {[{ id: "", name: "Anyone" }, ...members].map((m) => (
                      <Pressable
                        key={m.id}
                        accessibilityRole="button"
                        onPress={() => change("assigneeId")(m.id)}
                        style={[
                          s.chip,
                          (form.assigneeId || "") === m.id && s.chipActive,
                        ]}
                      >
                        <Text style={s.chipText}>{m.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
              {dialog?.kind === "agenda" && (
                <>
                  <Field
                    label="Moment"
                    value={form.title || ""}
                    onChange={change("title")}
                    placeholder="Meet up & final costume checks"
                  />
                  <Field
                    label="Time (24-hour)"
                    value={form.time || ""}
                    onChange={change("time")}
                    placeholder="13:30"
                  />
                  <Field
                    label="Location"
                    value={form.location || ""}
                    onChange={change("location")}
                    placeholder="North entrance"
                  />
                  <Field
                    label="Notes"
                    value={form.notes || ""}
                    onChange={change("notes")}
                    multiline
                    placeholder="Anything the crew should know"
                  />
                </>
              )}
              {dialog?.kind === "recover" && <PasswordRecovery config={publicConfig} onSignIn={() => open("login", "Welcome back")} />}
              {(dialog?.kind === "signup" || dialog?.kind === "login") && (
                <>
                  {dialog.kind === "signup" && (
                    <>
                      <Text style={s.body}>
                        Save your work, find other creators, and make something
                        together. Your profile starts private.
                      </Text>
                      <Field
                        label="Your name"
                        value={form.name || ""}
                        onChange={change("name")}
                        placeholder="What should we call you?"
                      />
                    </>
                  )}
                  <Field
                    label="Email"
                    value={form.email || ""}
                    onChange={change("email")}
                    keyboard="email-address"
                    placeholder="you@example.com"
                  />
                  <Field
                    label={
                      dialog.kind === "signup"
                        ? "Password (10+ characters)"
                        : "Password"
                    }
                    value={form.password || ""}
                    onChange={change("password")}
                    secret
                  />
                  {dialog.kind === "signup" && publicConfig?.requirePolicyAcceptance ? <View style={{ gap: 12 }}>
                    <Pressable accessibilityRole="checkbox" aria-checked={form.ageConfirmed === "yes"} accessibilityState={{ checked: form.ageConfirmed === "yes" }} onPress={() => change("ageConfirmed")(form.ageConfirmed === "yes" ? "" : "yes")} style={s.row}>
                      <Icon name={form.ageConfirmed === "yes" ? "checkbox" : "square-outline"} color={C.blue} />
                      <Text style={[s.body, { flex: 1 }]}>I am {publicConfig.minimumAge} or older.</Text>
                    </Pressable>
                    <Pressable accessibilityRole="checkbox" aria-checked={form.policyAccepted === "yes"} accessibilityState={{ checked: form.policyAccepted === "yes" }} onPress={() => change("policyAccepted")(form.policyAccepted === "yes" ? "" : "yes")} style={s.row}>
                      <Icon name={form.policyAccepted === "yes" ? "checkbox" : "square-outline"} color={C.blue} />
                      <Text style={[s.body, { flex: 1 }]}>I accept the Beta terms and Community standards and have read Privacy.</Text>
                    </Pressable>
                  </View> : null}
                  <PolicyLinks config={publicConfig} />
                  <Button
                    title={
                      busy
                        ? "One moment…"
                        : dialog.kind === "signup"
                          ? "Create account"
                          : "Sign in"
                    }
                    disabled={busy || (dialog.kind === "signup" && (!publicConfig || (publicConfig.requirePolicyAcceptance && (form.ageConfirmed !== "yes" || form.policyAccepted !== "yes"))))}
                    onPress={() => void submit()}
                  />
                  {dialog.kind === "login" ? <Button title="Forgot your password?" secondary onPress={() => open("recover", "Reset your password")} /> : null}
                  <Button
                    title={
                      dialog.kind === "signup"
                        ? "Already have an account? Sign in"
                        : "New here? Create an account"
                    }
                    secondary
                    onPress={() =>
                      open(
                        dialog.kind === "signup" ? "login" : "signup",
                        dialog.kind === "signup"
                          ? "Welcome back"
                          : "Make it yours",
                      )
                    }
                  />
                </>
              )}
              {dialog?.kind === "invite" && (
                <>
                  {busy && !invite ? (
                    <ActivityIndicator color={C.blue} />
                  ) : null}
                  {invite && (
                    <>
                      <View style={[s.card, { alignItems: "center" }]}>
                        <Icon
                          name="paper-plane-outline"
                          color={C.blue}
                          size={32}
                        />
                        <Text style={s.h2}>A spot in the crew.</Text>
                        <Text style={[s.body, { textAlign: "center" }]}>
                          Send this link to one person. It expires in 7 days and
                          can be used once.
                        </Text>
                      </View>
                      <Text selectable style={[s.input, { fontSize: 12 }]}>
                        {invite.url}
                      </Text>
                      <Button
                        title="Copy invitation link"
                        icon="copy-outline"
                        onPress={() => {
                          void Clipboard.setStringAsync(invite.url)
                            .then(() => notify("Invitation link copied."))
                            .catch(() =>
                              setError(
                                "Could not copy. Select and copy the link above.",
                              ),
                            );
                        }}
                      />
                      {Platform.OS !== "web" && (
                        <Button
                          title="Share invitation"
                          secondary
                          icon="share-outline"
                          onPress={() => {
                            void Share.share({
                              message: `Join my crew on Crewroom: ${invite.url}`,
                            }).catch((e) => setError(e.message));
                          }}
                        />
                      )}
                      <Text style={s.small}>
                        Send this private invitation only to the person you want
                        to join. A copied link has not been sent to anyone.
                      </Text>
                      <Button
                        title="Revoke this invitation"
                        secondary
                        disabled={busy}
                        onPress={() => {
                          setBusy(true);
                          void api
                            .revokeInvite(invite.id)
                            .then(() => {
                              setInvite(null);
                              setDialog(null);
                              notify("Invitation revoked.");
                            })
                            .catch((e) => setError(e.message))
                            .finally(() => setBusy(false));
                        }}
                      />
                    </>
                  )}
                </>
              )}
              {dialog?.kind === "join" && (
                <>
                  {!joinToken ? (
                    <>
                      <Field
                        label="Invitation link"
                        value={form.link || ""}
                        onChange={change("link")}
                        placeholder="Paste your Crewroom invitation"
                      />
                      <Button
                        title="Open invitation"
                        onPress={() => {
                          const token = getToken(form.link || "");
                          if (!token)
                            setError(
                              "Paste the full invitation link from your crew.",
                            );
                          else {
                            setJoinPreview(null);
                            setJoinToken(token);
                          }
                        }}
                      />
                    </>
                  ) : joinPreview?.token === joinToken ? (
                    <>
                      <View style={s.card}>
                        <Tag>Your people are waiting</Tag>
                        <Text style={s.h1}>{joinPreview.crewName}</Text>
                        <Text style={s.body}>
                          {joinPreview.inviterName} invited you to join their
                          crew.
                        </Text>
                      </View>
                      {!session?.user || session.user.isDemo ? (
                        <>
                          <Text style={s.body}>
                            Create an account or sign in to accept this
                            invitation.
                          </Text>
                          <Button
                            title="Create account to join"
                            onPress={() => open("signup", "Join your people")}
                          />
                          <Button
                            title="Sign in to join"
                            secondary
                            onPress={() => open("login", "Welcome back")}
                          />
                        </>
                      ) : (
                        <Button
                          title={busy ? "Joining…" : "Join this crew"}
                          disabled={busy}
                          onPress={() => void submit()}
                        />
                      )}
                    </>
                  ) : !error ? (
                    <ActivityIndicator color={C.blue} />
                  ) : null}
                  <Button
                    title="Use a different invitation"
                    secondary
                    onPress={() => {
                      setJoinToken("");
                      setJoinPreview(null);
                      setError("");
                      setForm({});
                    }}
                  />
                </>
              )}
              {dialog?.kind === "activity" && (
                <>
                  {data.activity.length ? (
                    data.activity.slice(0, 30).map((item) => (
                      <View key={item.id} style={s.row}>
                        <Avatar name={item.actorName} size={36} />
                        <View style={s.grow}>
                          <Text style={s.taskTitle}>
                            {item.actorName} {item.text}
                          </Text>
                          <Text style={s.small}>
                            {new Date(item.createdAt).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" },
                            )}
                          </Text>
                        </View>
                      </View>
                    ))
                  ) : (
                    <Empty
                      title="The beginning of something good"
                      text="Crew updates will show up here as you start making plans."
                    />
                  )}
                  <Button
                    title="Refresh activity"
                    secondary
                    onPress={() => void refresh()}
                  />
                </>
              )}
              {dialog?.kind === "removeMember" && (
                <Text style={s.body}>
                  {dialog.member?.userId === session?.user?.id
                    ? "You will lose access to this crew and its plans. Ask the captain for another invitation if you want to rejoin."
                    : "Their lineup entries will be removed and their tasks will become unassigned."}
                </Text>
              )}
              {dialog &&
                !["signup", "login", "invite", "join", "activity"].includes(
                  dialog.kind,
                ) && (
                  <Button
                    title={
                      busy
                        ? "Saving…"
                        : dialog.kind === "removeMember"
                          ? "Confirm removal"
                          : dialog.kind === "crew"
                            ? "Create crew"
                            : dialog.kind === "project"
                              ? "Create plan"
                              : dialog.kind === "task"
                                ? "Add task"
                                : dialog.kind === "agenda"
                                  ? "Add moment"
                                  : dialog.kind === "member"
                                    ? "Add planned member"
                                    : "Save changes"
                    }
                    disabled={busy}
                    onPress={() => void submit()}
                  />
                )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {appearanceOpen && (
        <Sheet title="Your screen, your choice" onClose={() => setAppearanceOpen(false)}>
          <AppearanceControl />
        </Sheet>
      )}
    </View>
  );
}
