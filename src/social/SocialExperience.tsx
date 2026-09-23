import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { socialApi } from "../api";
import type { User } from "../types";
import { Icon, useUI } from "../ui";
import type { CreativePost, CreatorProfile, ReportInput } from "./types";
import Discover from "./Discover";
import Composer from "./Composer";
import Profile, { EditProfile } from "./Profile";
import PostDetail from "./PostDetail";
import Inbox from "./Inbox";
import {
  BlockSheet,
  ReportSheet,
  RequestSheet,
  SettingsSheet,
} from "./Actions";
import { messageOf, needsReview, publicationMessage, reviewLabel } from "./shared";
import { useSocialStyles } from "./styles";

type Route = { type: "post" | "profile"; value: string };
type Tab = "discover" | "explore" | "saved" | "inbox" | "profile";
type SheetState =
  | { type: "compose"; post?: CreativePost }
  | { type: "editProfile"; profile: CreatorProfile }
  | { type: "request"; profile: CreatorProfile; post?: CreativePost }
  | { type: "report"; target: Pick<ReportInput, "targetId" | "targetType"> }
  | { type: "block"; profile: CreatorProfile }
  | { type: "settings" }
  | null;
interface Props {
  playbackSuspended?: boolean;
  user: User | null;
  onRequireAccount: () => void;
  onOpenProject: (projectId: string) => void;
  onOpenCrews: () => void;
  initialRoute?: Route | null;
  onClearRoute?: () => void;
  onAccountSettings?: () => void;
}

export default function SocialExperience({
  playbackSuspended = false,
  user,
  onRequireAccount,
  onOpenProject,
  onOpenCrews,
  initialRoute,
  onClearRoute,
  onAccountSettings,
}: Props) {
  const { C, s } = useUI();
  const x = useSocialStyles();
  const { width } = useWindowDimensions(),
    insets = useSafeAreaInsets(),
    wide = width >= 820;
  const [homeMode, setHomeMode] = useState<"discover" | "following">(
    "discover",
  );
  const [tab, setTab] = useState<Tab>("discover"),
    [routes, setRoutes] = useState<Route[]>([]),
    [sheet, setSheet] = useState<SheetState>(null),
    [revision, setRevision] = useState(0),
    [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    identity = useRef(`${user?.id || ""}:${user?.isDemo || false}`),
    generation = useRef(0);
  const notify = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);
  const changed = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    const next = `${user?.id || ""}:${user?.isDemo || false}`;
    if (identity.current !== next) {
      identity.current = next;
      generation.current++;
      setSheet(null);
      setToast("");
      changed();
    }
  }, [user?.id, user?.isDemo, changed]);
  useEffect(() => {
    if (initialRoute) setRoutes([initialRoute]);
  }, [initialRoute?.type, initialRoute?.value]);
  const back = useCallback(() => {
    if (sheet) {
      setSheet(null);
      return true;
    }
    if (routes.length) {
      setRoutes((v) => v.slice(0, -1));
      onClearRoute?.();
      return true;
    }
    return false;
  }, [sheet, routes.length, onClearRoute]);
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", back);
    return () => listener.remove();
  }, [back]);
  const openPost = (id: string) =>
    setRoutes((v) => [...v, { type: "post", value: id }]);
  const openProfile = (handle: string) =>
    setRoutes((v) => [...v, { type: "profile", value: handle }]);
  const navigate = (next: Tab) => {
    setTab(next);
    setRoutes([]);
    onClearRoute?.();
  };
  const create = () => {
    if (!user) {
      onRequireAccount();
      return;
    }
    setSheet({ type: "compose" });
  };
  const requireReal = () => {
    if (!user || user.isDemo) {
      onRequireAccount();
      return false;
    }
    return true;
  };
  const ensurePublic = async () => {
    if (!requireReal()) return false;
    const current = generation.current;
    try {
      const me = await socialApi.getMe();
      if (current !== generation.current) return false;
      if (me.visibility === "public" && me.reviewStatus === "approved" && !needsReview(me))
        return true;
      if (me.visibility === "public" && me.reviewStatus === "pending") {
        notify(
          `${reviewLabel(me)}. Following, comments, and collaboration requests become available once your profile is approved.`,
        );
        return false;
      }
      setSheet({ type: "editProfile", profile: me });
      notify(
        me.reviewStatus === "rejected"
          ? "Update your profile and submit it again for review before connecting."
          : "Make your creator profile public before connecting with other creators.",
      );
      return false;
    } catch (e) {
      notify(messageOf(e));
      return false;
    }
  };
  const save = async (post: CreativePost, surfaceError = false) => {
    if (
      !user ||
      (user.isDemo && !post.isExample && post.author.userId !== user.id)
    ) {
      onRequireAccount();
      return;
    }
    const current = generation.current;
    try {
      await socialApi.savePost(post.id, !post.viewerSaved);
      if (current !== generation.current) return;
      changed();
      notify(
        post.viewerSaved
          ? "Removed from your private collection."
          : "Saved to your private collection.",
      );
    } catch (e) {
      if (current === generation.current) {
        if (surfaceError) throw e;
        notify(messageOf(e));
      }
    }
  };
  const request = async (profile: CreatorProfile, post?: CreativePost) => {
    if (profile.isExample) return;
    if (await ensurePublic()) setSheet({ type: "request", profile, post });
  };
  const report = (target: Pick<ReportInput, "targetId" | "targetType">) => {
    if (requireReal()) setSheet({ type: "report", target });
  };
  const block = (profile: CreatorProfile) => {
    if (requireReal() && !profile.isExample)
      setSheet({ type: "block", profile });
  };
  const route = routes[routes.length - 1];
  const profileProps = {
    user,
    wide,
    revision,
    onAccount: onRequireAccount,
    onPost: openPost,
    onProfile: openProfile,
    onSave: save,
    onCrews: onOpenCrews,
    onCreate: create,
    onEdit: (profile: CreatorProfile) =>
      setSheet({ type: "editProfile", profile }),
    onSettings: () => setSheet({ type: "settings" }),
    onRequest: (profile: CreatorProfile) => void request(profile),
    onReport: (profile: CreatorProfile) =>
      report({ targetType: "profile", targetId: profile.userId }),
    onBlock: block,
    ensurePublic,
    onChanged: changed,
  };
  const navItems = [
    { key: "discover", label: "Home", icon: "home-outline" },
    { key: "explore", label: "Explore", icon: "search-outline" },
    { key: "create", label: "Create", icon: "add" },
    { key: "inbox", label: "Inbox", icon: "notifications-outline" },
    { key: "profile", label: "Profile", icon: "person-outline" },
  ] as const;
  return (
    <View style={x.screen}>
      {route && (
        <View
          style={[x.toolbar, { paddingHorizontal: 22, paddingVertical: 4 }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={back}
            style={[x.row, { minHeight: 44 }]}
          >
            <Icon name="arrow-back" size={20} />
            <Text style={x.label}>Back</Text>
          </Pressable>
          <Text style={[x.label, { color: C.muted }]}>
            {route.type === "post" ? "Build showcase" : "Creator profile"}
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        {route?.type === "post" ? (
          <PostDetail
            key={`${route.value}:${user?.id || "anonymous"}`}
            id={route.value}
            playbackSuspended={playbackSuspended || !!sheet}
            user={user}
            wide={wide}
            revision={revision}
            onProfile={openProfile}
            onSave={save}
            onEdit={(post) => setSheet({ type: "compose", post })}
            onRequest={(profile, post) => void request(profile, post)}
            onReport={report}
            onBlock={block}
            ensurePublic={ensurePublic}
            onChanged={changed}
            onDeleted={() => {
              setRoutes((v) => v.slice(0, -1));
              onClearRoute?.();
              changed();
              notify("Post deleted.");
            }}
            notify={notify}
          />
        ) : route?.type === "profile" ? (
          <Profile key={route.value} {...profileProps} handle={route.value} />
        ) : tab === "profile" ? (
          <Profile key={`self:${user?.id || "anonymous"}`} {...profileProps} />
        ) : tab === "inbox" ? (
          <Inbox
            user={user}
            revision={revision}
            onAccount={onRequireAccount}
            onPost={openPost}
            onProfile={openProfile}
            onProject={onOpenProject}
            onChanged={changed}
            notify={notify}
          />
        ) : (
          <Discover
            key={tab}
            user={user}
            playbackSuspended={playbackSuspended || !!sheet}
            saved={tab === "saved"}
            explore={tab === "explore"}
            onSaved={() => navigate("saved")}
            initialMode={tab === "explore" ? "discover" : homeMode}
            onHome={(mode) => {
              setHomeMode(mode);
              navigate("discover");
            }}
            onFocusSave={(post) => save(post, true)}
            wide={wide}
            revision={revision}
            onAccount={onRequireAccount}
            onPost={openPost}
            onProfile={openProfile}
            onSave={save}
            onCrews={onOpenCrews}
            onCreate={create}
          />
        )}
      </View>
      <View
        accessibilityRole="tablist"
        style={[x.nav, { paddingBottom: Math.max(9, insets.bottom) }]}
      >
        {navItems.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole={item.key === "create" ? "button" : "tab"}
            accessibilityLabel={
              item.key === "create" ? "Create a project post" : item.label
            }
            accessibilityState={{
              selected:
                !route && (tab === "saved" ? "discover" : tab) === item.key,
            }}
            aria-selected={
              item.key === "create"
                ? undefined
                : !route && (tab === "saved" ? "discover" : tab) === item.key
            }
            onPress={() =>
              item.key === "create" ? create() : navigate(item.key)
            }
            style={[
              x.navItem,
              !route &&
                (tab === "saved" ? "discover" : tab) === item.key &&
                x.navActive,
            ]}
          >
            {item.key === "create" ? (
              <View style={x.createNav}>
                <Icon name="add" color={C.onAccent} size={24} />
              </View>
            ) : (
              <Icon
                name={item.icon}
                color={
                  !route && (tab === "saved" ? "discover" : tab) === item.key
                    ? C.blue
                    : C.muted
                }
                size={25}
              />
            )}
            <Text
              style={[
                x.navLabel,
                !route &&
                  (tab === "saved" ? "discover" : tab) === item.key && {
                    color: C.ink,
                  },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {!!toast && (
        <View
          accessibilityRole="alert"
          style={[x.toast, { bottom: 85 + insets.bottom }]}
        >
          <Text style={x.toastText}>{toast}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss notice"
            style={x.iconButton}
            onPress={() => setToast("")}
          >
            <Icon name="close" color={C.onInverse} size={18} />
          </Pressable>
        </View>
      )}
      {sheet?.type === "compose" && user && (
        <Composer
          key={sheet.post?.id || "new"}
          user={user}
          post={sheet.post}
          onClose={() => setSheet(null)}
          onSaved={(post) => {
            setSheet(null);
            changed();
            setRoutes([{ type: "post", value: post.id }]);
            notify(
              post.visibility === "private"
                ? "Private draft saved."
                : user.isDemo
                  ? "Demo preview saved. Only you can see it."
                  : post.reviewStatus === "approved" && !needsReview(post) &&
                      (post.author.visibility !== "public" || needsReview(post.author))
                    ? "Post saved. It stays visible only to you until your profile is public and approved."
                    : publicationMessage(post, "Post"),
            );
          }}
        />
      )}
      {sheet?.type === "editProfile" && user && (
        <EditProfile
          profile={sheet.profile}
          user={user}
          onClose={() => setSheet(null)}
          onSaved={(profile) => {
            setRoutes((v) =>
              v.map((r) =>
                r.type === "profile" && r.value === sheet.profile.handle
                  ? { ...r, value: profile.handle }
                  : r,
              ),
            );
            setSheet(null);
            changed();
            notify(
              profile.visibility === "public"
                ? user.isDemo
                  ? "Demo profile preview saved."
                  : publicationMessage(profile, "Profile")
                : "Your profile is private.",
            );
          }}
        />
      )}
      {sheet?.type === "request" && (
        <RequestSheet
          recipient={sheet.profile}
          post={sheet.post}
          onClose={() => setSheet(null)}
          onSent={() => {
            setSheet(null);
            changed();
            notify("Request sent. Find it in Inbox → Sent.");
          }}
        />
      )}
      {sheet?.type === "report" && (
        <ReportSheet
          target={sheet.target}
          onClose={() => setSheet(null)}
          onReported={() => {
            if (sheet.target.targetType === "post") {
              setRoutes([]);
              setTab("discover");
              onClearRoute?.();
            }
            setSheet(null);
            changed();
            notify("Your report was saved for review.");
          }}
        />
      )}
      {sheet?.type === "block" && (
        <BlockSheet
          profile={sheet.profile}
          onClose={() => setSheet(null)}
          onBlocked={() => {
            setSheet(null);
            navigate("discover");
            changed();
            notify(
              "Creator blocked. You can manage blocks in your profile settings.",
            );
          }}
        />
      )}
      {sheet?.type === "settings" && (
        <SettingsSheet
          onAccountSettings={
            onAccountSettings
              ? () => {
                  setSheet(null);
                  onAccountSettings();
                }
              : undefined
          }
          onClose={() => setSheet(null)}
          onChanged={changed}
          notify={notify}
        />
      )}
    </View>
  );
}
