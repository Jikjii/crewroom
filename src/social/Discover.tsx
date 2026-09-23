import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { mediaSource, socialApi } from "../api";
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
import FocusFeed from "./FocusFeed";

interface Props {
  playbackSuspended?: boolean;
  user: User | null;
  saved?: boolean;
  explore?: boolean;
  onSaved: () => void;
  onHome: (mode: "discover" | "following") => void;
  initialMode?: "discover" | "following";
  onFocusSave: (post: CreativePost) => Promise<void>;
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
  playbackSuspended = false,
  user,
  saved = false,
  explore = false,
  onSaved,
  onHome,
  initialMode = "discover",
  onFocusSave,
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
  const [mode, setMode] = useState<"discover" | "following">(initialMode),
    [surface, setSurface] = useState<"work" | "people">("work");
  const [query, setQuery] = useState(""),
    [q, setQ] = useState(""),
    [stage, setStage] = useState<CreativeStage | undefined>(),
    [openRoles, setOpenRoles] = useState(false),
    [role, setRole] = useState("");
  const [videoMode, setVideoMode] = useState(false);
  const [videoCursor, setVideoCursor] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState("");
  const videoRequest = useRef(0);
  useEffect(
    () => () => {
      videoRequest.current++;
    },
    [],
  );
  const openVideos = async () => {
    if (videoLoading) return;
    const version = ++videoRequest.current;
    setVideoLoading(true);
    setVideoError("");
    try {
      const config = await socialApi.getVideoConfig();
      if (!config.enabled)
        throw new Error(
          "Video is not available on this server yet. Please try again after the beta update.",
        );
      const result = await socialApi.getFeed({ mediaType: "video" });
      if (version !== videoRequest.current) return;
      setVideoMode(true);
      setVideoCursor(result.nextCursor);
      setFocusPosts(result.items);
    } catch (e) {
      if (version === videoRequest.current) setVideoError(messageOf(e));
    } finally {
      if (version === videoRequest.current) setVideoLoading(false);
    }
  };
  const [focusPosts, setFocusPosts] = useState<CreativePost[] | null>(null);
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
    <>
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
            ? { paddingHorizontal: 28, gap: 16 }
            : { paddingHorizontal: 16, gap: 14 },
        ]}
      >
        {explore ? (
          <View style={{ gap: 6 }}>
            <Text style={[x.title, { fontSize: 30, lineHeight: 36 }]}>
              Find your people.
            </Text>
            <Text style={x.small}>
              The characters, crafts, and creators behind your next idea.
            </Text>
          </View>
        ) : (
          <View style={[x.toolbar, { gap: 8 }]}>
            <View
              accessibilityRole="tablist"
              style={[x.tabRow, { borderBottomWidth: 0, gap: wide ? 26 : 18 }]}
            >
              {(["discover", "following", "saved"] as const).map((value) => {
                const selected = saved ? value === "saved" : mode === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    aria-selected={selected}
                    onPress={() => {
                      if (value === "saved") onSaved();
                      else if (saved) onHome(value);
                      else {
                        setMode(value);
                        setSurface("work");
                      }
                    }}
                    style={[x.textTab, selected && x.textTabActive]}
                  >
                    <Text
                      style={{
                        fontSize: wide ? 20 : 17,
                        fontWeight: "800",
                        color: selected ? C.ink : C.muted,
                      }}
                    >
                      {value === "discover"
                        ? "Discover"
                        : value === "following"
                          ? "Following"
                          : "Saved"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!!feed.data?.items.length && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open full-screen work feed"
                onPress={() => {
                  setVideoMode(false);
                  setFocusPosts(feed.data!.items);
                }}
                style={[
                  x.iconButton,
                  {
                    backgroundColor: C.white,
                    borderWidth: 1,
                    borderColor: C.line,
                  },
                ]}
              >
                <Icon name="scan-outline" color={C.blue} size={22} />
              </Pressable>
            )}
          </View>
        )}
        {Platform.OS !== "web" && !saved && !explore && (
          <View style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open video feed"
              accessibilityState={{ disabled: videoLoading }}
              disabled={videoLoading}
              onPress={() => void openVideos()}
              style={[
                x.row,
                {
                  backgroundColor: C.white,
                  borderColor: C.line,
                  borderWidth: 1,
                  borderRadius: 18,
                  padding: 15,
                  minHeight: 60,
                },
              ]}
            >
              <View
                style={{
                  backgroundColor: C.accent,
                  borderRadius: 14,
                  padding: 10,
                }}
              >
                <Icon name="play" color="#FFFFFF" size={20} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={x.label}>
                  {videoLoading ? "Opening videos…" : "Builds in motion"}
                </Text>
                <Text style={x.small}>
                  Watch cosplay videos · swipe to explore
                </Text>
              </View>
              <Icon name="arrow-forward" color={C.blue} />
            </Pressable>
            <ErrorNotice message={videoError} retry={() => void openVideos()} />
          </View>
        )}
        {saved && (
          <Text style={x.small}>
            Your inspiration, saved. Only you can see this collection.
          </Text>
        )}
        {explore && (
          <View accessibilityRole="tablist" style={x.tabRow}>
            {(["work", "people"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: surface === value }}
                aria-selected={surface === value}
                onPress={() => setSurface(value)}
                style={[x.textTab, surface === value && x.textTabActive]}
              >
                <Text
                  style={[
                    x.label,
                    {
                      fontSize: 16,
                      color: surface === value ? C.ink : C.muted,
                    },
                  ]}
                >
                  {value === "work" ? "Cosplay & builds" : "Creators"}
                </Text>
              </Pressable>
            ))}
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
            {(explore || saved || mode === "following") && (
              <View style={x.search}>
                <Icon name="search-outline" color={C.muted} />
                <TextInput
                  accessibilityLabel={
                    surface === "people"
                      ? "Search creators"
                      : "Search cosplay work"
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
            )}
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
                      <Avatar
                        name={profile.displayName}
                        source={profile.avatar ? mediaSource(profile.avatar) : undefined}
                        size={48}
                      />
                      <View style={x.grow}>
                        <Text style={x.sectionTitle}>
                          {profile.displayName}
                        </Text>
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
        {!saved && (
          <Pressable
            accessibilityRole="button"
            onPress={onCrews}
            style={[x.card, { marginTop: 8 }]}
          >
            <View style={x.toolbar}>
              <View style={{ gap: 5, flex: 1 }}>
                <Text style={[x.sectionTitle, { fontSize: 20 }]}>
                  Better with a crew.
                </Text>
                <Text style={x.small}>
                  Plan the shoot. Share the prep. Make it happen.
                </Text>
              </View>
              <Icon name="arrow-forward" color={C.blue} />
            </View>
            <Text style={x.link}>Open my private crews</Text>
          </Pressable>
        )}
      </ScrollView>
      {focusPosts && (
        <FocusFeed
          posts={focusPosts}
          videoFeed={videoMode}
          suspended={playbackSuspended}
          allowSharing={!user?.isDemo}
          initialCursor={videoCursor}
          onClose={() => setFocusPosts(null)}
          onPost={onPost}
          onProfile={onProfile}
          onSave={async (post) => {
            if (
              !user ||
              (user.isDemo && !post.isExample && post.author.userId !== user.id)
            ) {
              setFocusPosts(null);
              onAccount();
              return;
            }
            await onFocusSave(post);
          }}
        />
      )}
    </>
  );
}
