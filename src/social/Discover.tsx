import React, { useEffect, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { socialApi } from "../api";
import type { User } from "../types";
import { Avatar, Button, Empty, Icon, Tag, useUI } from "../ui";
import type {
  CreativePost,
  CreativeStage,
  CreatorProfile,
  FeedOptions,
  FeedResult,
} from "./types";
import {
  AccountPrompt,
  Choice,
  ErrorNotice,
  Spinner,
  WorkGrid,
  messageOf,
  useResource,
} from "./shared";
import { useSocialStyles } from "./styles";

interface Props {
  user: User | null;
  saved?: boolean;
  wide: boolean;
  revision: number;
  onAccount: () => void;
  onPost: (id: string) => void;
  onProfile: (handle: string) => void;
  onSave: (post: CreativePost) => Promise<void>;
  onCrews: () => void;
  onCreate: () => void;
}

export default function Discover({
  user,
  saved = false,
  wide,
  revision,
  onAccount,
  onPost,
  onProfile,
  onSave,
  onCrews,
  onCreate,
}: Props) {
  const { C, s, resolved } = useUI();
  const x = useSocialStyles();
  const [mode, setMode] = useState<"discover" | "following">("discover"),
    [surface, setSurface] = useState<"work" | "people">("work");
  const [query, setQuery] = useState(""),
    [q, setQ] = useState(""),
    [stage, setStage] = useState<CreativeStage | undefined>(),
    [openRoles, setOpenRoles] = useState(false),
    [role, setRole] = useState("");
  const [more, setMore] = useState(false),
    [pageError, setPageError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const accountNeeded =
    (saved && !user) ||
    (!saved && mode === "following" && (!user || user.isDemo));
  const options: FeedOptions = {
    mode: saved ? "saved" : mode,
    q,
    stage,
    openRoles,
  };
  const feed = useResource<FeedResult>(
    () =>
      accountNeeded
        ? Promise.resolve({ items: [], nextCursor: null })
        : socialApi.getFeed(options),
    [saved, mode, q, stage, openRoles, revision, user?.id, user?.isDemo],
  );
  const people = useResource<CreatorProfile[]>(
    () =>
      !saved && surface === "people"
        ? socialApi.getProfiles({ q, role: role || undefined })
        : Promise.resolve([]),
    [surface, saved, q, role, revision, user?.id],
  );
  const active = surface === "people" && !saved ? people : feed;
  const pageKey = JSON.stringify([
    saved,
    mode,
    q,
    stage,
    openRoles,
    revision,
    user?.id,
    user?.isDemo,
  ]);
  const pageKeyRef = useRef(pageKey);
  pageKeyRef.current = pageKey;
  useEffect(() => {
    setMore(false);
    setPageError("");
  }, [pageKey]);
  const loadMore = async () => {
    if (more || !feed.data?.nextCursor) return;
    const key = pageKeyRef.current;
    setMore(true);
    setPageError("");
    try {
      const next = await socialApi.getFeed({
        ...options,
        cursor: feed.data.nextCursor,
      });
      if (pageKeyRef.current !== key) return;
      feed.setData((prev) =>
        prev
          ? {
              items: [
                ...prev.items,
                ...next.items.filter(
                  (p) => !prev.items.some((old) => old.id === p.id),
                ),
              ],
              nextCursor: next.nextCursor,
            }
          : next,
      );
    } catch (e) {
      if (pageKeyRef.current === key) setPageError(messageOf(e));
    } finally {
      if (pageKeyRef.current === key) setMore(false);
    }
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={active.loading && !!active.data}
          onRefresh={() => void active.reload()}
          tintColor={C.blue}
        />
      }
      contentContainerStyle={[
        x.content,
        wide
          ? { paddingHorizontal: 30, gap: 16 }
          : { paddingHorizontal: 18, gap: 14 },
      ]}
    >
      <View style={x.toolbar}>
        <Text style={[x.eyebrow, { flex: 1 }]}>
          {saved
            ? "Your collection"
            : wide
              ? "THE CREATIVE SIDE OF COSPLAY"
              : "THE CREATIVE SIDE"}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onCrews}
          style={[x.row, { minHeight: 44 }]}
        >
          <Text style={x.link}>My crews</Text>
          <Icon name="arrow-forward" size={16} color={C.blue} />
        </Pressable>
      </View>
      {saved ? (
        <View style={{ gap: 9 }}>
          <Text style={x.title}>Keep the inspiration.</Text>
          <Text style={x.intro}>
            Work you want to come back to. Your saves are private.
          </Text>
        </View>
      ) : (
        <View style={[x.hero, { padding: wide ? 20 : 18, gap: 8 }]}>
          <Text
            style={[
              x.title,
              wide
                ? { fontSize: 36, lineHeight: 40 }
                : { fontSize: 30, lineHeight: 33, letterSpacing: -1.1 },
            ]}
          >
            Made to be seen.{wide ? " " : "\n"}Better together.
          </Text>
          <Text style={[x.intro, !wide && { fontSize: 12, lineHeight: 18 }]}>
            {wide
              ? "A home for your cosplay, the work behind it, and the people who get it."
              : "Your cosplay. Your process. Your people."}
          </Text>
        </View>
      )}
      {!saved && (
        <View style={x.toolbar}>
          <View accessibilityRole="tablist" style={x.tabRow}>
            {(["discover", "following"] as const).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === t }}
                aria-selected={mode === t}
                onPress={() => {
                  setMode(t);
                  setSurface("work");
                }}
                style={[x.textTab, mode === t && x.textTabActive]}
              >
                <Text
                  style={[x.label, { color: mode === t ? C.ink : C.muted }]}
                >
                  {t === "discover" ? "Discover" : "Following"}
                </Text>
              </Pressable>
            ))}
          </View>
          {mode === "discover" && (
            <View style={x.row}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setSurface(surface === "work" ? "people" : "work")
                }
                style={[x.row, { minHeight: 44 }]}
              >
                <Icon
                  name={
                    surface === "work" ? "people-outline" : "images-outline"
                  }
                  size={17}
                  color={C.blue}
                />
                <Text style={x.link}>
                  {surface === "work" ? "Find creators" : "See work"}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
      {accountNeeded ? (
        <AccountPrompt
          onPress={onAccount}
          title={
            saved
              ? "Make a collection of your own"
              : "Your people, in one place"
          }
          text={
            saved
              ? "Save work to revisit whenever inspiration strikes. Your collection stays private."
              : "Follow real creators to see their work here. No posting schedule required."
          }
        />
      ) : (
        <>
          <View style={x.search}>
            <Icon name="search-outline" color={C.muted} />
            <TextInput
              accessibilityLabel={
                surface === "people" ? "Search creators" : "Search cosplay work"
              }
              placeholder={
                surface === "people"
                  ? "Search creators, skills, or fandoms"
                  : "Search characters, fandoms, or ideas…"
              }
              placeholderTextColor={C.muted}
              keyboardAppearance={resolved}
              selectionColor={C.blue}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => setQ(query.trim())}
              style={x.searchInput}
            />
            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                onPress={() => setQuery("")}
                style={x.iconButton}
              >
                <Icon name="close" size={18} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {surface === "people" && !saved ? (
              ["", "Cosplayer", "Photographer", "Maker"].map((r) => (
                <Choice
                  key={r}
                  label={r || "All creators"}
                  active={role === r}
                  onPress={() => setRole(r)}
                />
              ))
            ) : (
              <>
                <Choice
                  label="All work"
                  active={!stage && !openRoles}
                  onPress={() => {
                    setStage(undefined);
                    setOpenRoles(false);
                  }}
                />
                {(["finished", "wip", "tutorial"] as const).map((value) => (
                  <Choice
                    key={value}
                    label={
                      value === "finished"
                        ? "Finished work"
                        : value === "wip"
                          ? "In progress"
                          : "Tutorials"
                    }
                    active={stage === value}
                    onPress={() =>
                      setStage(stage === value ? undefined : value)
                    }
                  />
                ))}
                <Choice
                  label="Open collaborations"
                  active={openRoles}
                  onPress={() => setOpenRoles((v) => !v)}
                />
              </>
            )}
          </ScrollView>
          <ErrorNotice
            message={active.error}
            retry={() => void active.reload()}
          />
          {active.loading && !active.data ? (
            <Spinner />
          ) : surface === "people" && !saved ? (
            <View style={x.grid}>
              {people.data?.map((profile) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View ${profile.displayName}`}
                  key={profile.userId}
                  onPress={() => onProfile(profile.handle)}
                  style={[x.card, { width: wide ? "48.7%" : "100%" }]}
                >
                  <View style={x.row}>
                    <Avatar name={profile.displayName} size={48} />
                    <View style={x.grow}>
                      <Text style={x.sectionTitle}>{profile.displayName}</Text>
                      <Text style={x.small}>@{profile.handle}</Text>
                    </View>
                    <Icon name="arrow-forward" size={18} color={C.blue} />
                  </View>
                  <Text numberOfLines={3} style={x.body}>
                    {profile.bio ||
                      "A little creativity, a lot of possibility."}
                  </Text>
                  <View style={x.wrap}>
                    {profile.roles.map((r) => (
                      <Tag key={r} tone="muted">
                        {r}
                      </Tag>
                    ))}
                  </View>
                  {profile.isExample ? (
                    <Text style={x.small}>Fictional example creator</Text>
                  ) : profile.openToCollab ? (
                    <Text style={[x.small, { color: C.green }]}>
                      Open to collaborating
                      {profile.city ? ` · ${profile.city}` : ""}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
              {!people.data?.length && !people.error && (
                <Empty
                  title="Make room for your kind of creative"
                  text="Try another name, role, or fandom."
                />
              )}
            </View>
          ) : (
            <>
              {!!feed.data?.items.some((p) => p.isExample) && (
                <View style={[x.row, { alignItems: "flex-start" }]}>
                  <Icon
                    name="color-palette-outline"
                    color={C.muted}
                    size={16}
                  />
                  <Text style={[x.small, { flex: 1 }]}>
                    {wide
                      ? "Includes fictional, AI-illustrated examples. Each example is labeled on its project."
                      : "Includes labeled, AI-illustrated examples."}
                  </Text>
                </View>
              )}
              <WorkGrid
                posts={feed.data?.items || []}
                wide={wide}
                onOpen={onPost}
                onProfile={onProfile}
                onSave={onSave}
              />
              {!feed.data?.items.length && !feed.error && (
                <Empty
                  title={
                    saved
                      ? "Your next idea belongs here"
                      : mode === "following"
                        ? "A quieter kind of feed"
                        : "The next story could be yours"
                  }
                  text={
                    saved
                      ? "Save a project to start your collection."
                      : mode === "following"
                        ? "Follow creators from Discover to see their work."
                        : "No work matches these filters yet. Try another search, or share your own."
                  }
                  action={
                    saved || mode === "following"
                      ? undefined
                      : "Share your work"
                  }
                  onPress={onCreate}
                />
              )}
              <ErrorNotice message={pageError} />
              {feed.data?.nextCursor && (
                <Button
                  title={more ? "Loading…" : "See more work"}
                  secondary
                  disabled={more}
                  onPress={() => void loadMore()}
                />
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
