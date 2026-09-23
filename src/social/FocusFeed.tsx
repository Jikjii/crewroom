import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getPublicWebUrl, mediaSource, socialApi } from "../api";
import { Avatar, Icon, useUI } from "../ui";
import type { CreativePost } from "./types";
import { messageOf, needsReview, stageName } from "./shared";
import VideoPlayer from "./VideoPlayer";

/** Full-screen projects, with native video playback and a paginated video mode. */
export default function FocusFeed({
  posts: initialPosts,
  onClose,
  onPost,
  onProfile,
  onSave,
  videoFeed = false,
  initialCursor = null,
  allowSharing = true,
  suspended = false,
}: {
  posts: CreativePost[];
  onClose: () => void;
  onPost: (id: string) => void;
  onProfile: (handle: string) => void;
  onSave: (post: CreativePost) => Promise<void>;
  videoFeed?: boolean;
  initialCursor?: string | null;
  allowSharing?: boolean;
  suspended?: boolean;
}) {
  const { C } = useUI();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [posts, setPosts] = useState(() =>
    videoFeed
      ? initialPosts.filter((post) => post.media[0]?.kind === "video")
      : initialPosts,
  );
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  const [sharing, setSharing] = useState(false);
  // Keep the listener's choice while individual video cards mount and unmount.
  const [muted, setMuted] = useState(true);
  const lock = useRef(false);
  const pageLock = useRef(false);
  const autoLoadArmed = useRef(true);
  const pendingIndex = useRef<number | null>(null);
  const mounted = useRef(true);
  const list = useRef<FlatList<CreativePost>>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (pendingIndex.current === null || pendingIndex.current >= posts.length)
      return;
    const target = pendingIndex.current;
    pendingIndex.current = null;
    list.current?.scrollToIndex({ index: target, animated: true });
  }, [posts.length]);
  const go = (next: number) => {
    if (!posts.length) return;
    const target = Math.max(0, Math.min(posts.length - 1, next));
    list.current?.scrollToIndex({ index: target, animated: true });
  };
  const loadMore = async (advance = false) => {
    if (!videoFeed || !cursor || pageLock.current) return;
    pageLock.current = true;
    autoLoadArmed.current = false;
    setLoadingMore(true);
    setPageError("");
    try {
      const result = await socialApi.getFeed({ mediaType: "video", cursor });
      if (!mounted.current) return;
      const existingIds = new Set(posts.map((post) => post.id));
      const fresh = result.items.filter((post) => {
        if (existingIds.has(post.id) || post.media[0]?.kind !== "video")
          return false;
        existingIds.add(post.id);
        return true;
      });
      if (advance && fresh.length) pendingIndex.current = posts.length;
      setPosts((current) => [...current, ...fresh]);
      // A repeated cursor must not start an endless fetch cycle.
      setCursor(result.nextCursor === cursor ? null : result.nextCursor);
    } catch (e) {
      if (mounted.current) setPageError(messageOf(e));
    } finally {
      pageLock.current = false;
      if (mounted.current) setLoadingMore(false);
    }
  };
  const openPost = (post: CreativePost) => {
    onClose();
    onPost(post.id);
  };
  const share = async (post: CreativePost) => {
    if (lock.current) return;
    lock.current = true;
    setSharing(true);
    setError("");
    try {
      const url = getPublicWebUrl(`/p/${encodeURIComponent(post.id)}`);
      if (Platform.OS === "web") {
        await Clipboard.setStringAsync(url);
        if (mounted.current) setError("Public project link copied.");
      } else {
        await Share.share({
          message: `${post.title} on Crewroom${post.isExample ? " · fictional AI-illustrated example" : ""}\n${url}`,
        });
      }
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      lock.current = false;
      if (mounted.current) setSharing(false);
    }
  };
  const save = async (post: CreativePost) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(post.id);
    setError("");
    try {
      await onSave(post);
      // Read the real saved state rather than assuming a sign-in or save succeeded.
      const result = await socialApi.getPost(post.id);
      if (mounted.current)
        setPosts((all) => all.map((p) => (p.id === post.id ? result.post : p)));
    } catch (e) {
      if (mounted.current) setError(messageOf(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy("");
    }
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={f.root}>
        <FlatList
          ref={list}
          data={posts}
          keyExtractor={(p) => p.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          extraData={{ index, busy, sharing, muted, suspended }}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={3}
          onScrollBeginDrag={() => {
            autoLoadArmed.current = true;
          }}
          onEndReachedThreshold={0.35}
          onEndReached={() => {
            if (autoLoadArmed.current && !pageError) void loadMore();
          }}
          getItemLayout={(_, i) => ({
            length: height,
            offset: height * i,
            index: i,
          })}
          scrollEventThrottle={80}
          onScroll={(e) =>
            setIndex(
              Math.max(
                0,
                Math.min(
                  posts.length - 1,
                  Math.round(e.nativeEvent.contentOffset.y / height),
                ),
              ),
            )
          }
          renderItem={({ item: post, index: itemIndex }) => (
            <View style={{ height, width, backgroundColor: "#09090E" }}>
              {post.media[0]?.kind === "video" && itemIndex === index ? (
                <VideoPlayer
                  media={post.media[0]}
                  active={!sharing && !suspended}
                  suspended={suspended}
                  controls={false}
                  muted={muted}
                  onMutedChange={setMuted}
                  style={StyleSheet.absoluteFill}
                />
              ) : post.media[0] &&
                (post.media[0].kind !== "video" || post.media[0].posterUrl) ? (
                <Image
                  source={mediaSource(post.media[0], { poster: true })}
                  accessibilityLabel={post.media[0].alt || post.title}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              ) : (
                <View style={[f.noImage, { height }]}>
                  <Icon
                    name={
                      post.media[0]?.kind === "video"
                        ? "videocam-outline"
                        : "images-outline"
                    }
                    size={60}
                    color="#A9A3BE"
                  />
                </View>
              )}
              <View
                style={[
                  f.bottom,
                  {
                    bottom: Math.max(22, insets.bottom + 12),
                    maxWidth: width >= 820 ? 760 : undefined,
                    alignSelf: "center",
                    width: "100%",
                  },
                ]}
              >
                <View style={{ flex: 1, gap: 10 }}>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
                  >
                    <Text style={f.badge}>{stageName(post.stage)}</Text>
                    {post.isExample && (
                      <Text style={f.badge}>AI-illustrated example</Text>
                    )}
                    {post.visibility === "private" && (
                      <Text style={f.badge}>Private draft</Text>
                    )}
                    {(needsReview(post) || needsReview(post.author)) && (
                      <Text style={f.badge}>Not public · review required</Text>
                    )}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View ${post.author.displayName}'s profile`}
                    style={f.author}
                    onPress={() => {
                      onClose();
                      onProfile(post.author.handle);
                    }}
                  >
                    <Avatar
                      name={post.author.displayName}
                      source={post.author.avatar ? mediaSource(post.author.avatar) : undefined}
                      size={40}
                      color={C.lavender}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={f.creator}>{post.author.displayName}</Text>
                      <Text style={f.caption}>@{post.author.handle}</Text>
                    </View>
                  </Pressable>
                  <Text style={f.title} numberOfLines={2}>
                    {post.title}
                  </Text>
                  {!!post.body && (
                    <Text style={f.description} numberOfLines={3}>
                      {post.body}
                    </Text>
                  )}
                  {!!post.fandom && (
                    <Text style={[f.caption, { color: "#E6CBFF" }]}>
                      {post.fandom}
                      {post.character ? ` · ${post.character}` : ""}
                    </Text>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openPost(post)}
                    style={[f.details, { backgroundColor: C.accent }]}
                  >
                    <Text style={f.detailsText}>View project & credits</Text>
                    <Icon name="arrow-forward" color="#FFFFFF" size={18} />
                  </Pressable>
                </View>
                <View style={f.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      post.viewerSaved
                        ? `Unsave ${post.title}`
                        : `Save ${post.title}`
                    }
                    accessibilityState={{
                      selected: post.viewerSaved,
                      disabled: !!busy,
                    }}
                    aria-pressed={post.viewerSaved}
                    disabled={!!busy}
                    style={f.action}
                    onPress={() => void save(post)}
                  >
                    {busy === post.id ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Icon
                        name={
                          post.viewerSaved ? "bookmark" : "bookmark-outline"
                        }
                        color={post.viewerSaved ? "#FF2D9B" : "#FFFFFF"}
                        size={28}
                      />
                    )}
                    <Text style={f.actionLabel}>
                      {post.viewerSaved ? "Saved" : "Save"}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View comments on ${post.title}`}
                    style={f.action}
                    onPress={() => openPost(post)}
                  >
                    <Icon name="chatbubble-outline" color="#FFFFFF" size={28} />
                    <Text style={f.actionLabel}>
                      {post.commentCount}{" "}
                      {post.commentCount === 1 ? "comment" : "comments"}
                    </Text>
                  </Pressable>
                  {(post.isExample ||
                    (allowSharing &&
                      post.visibility === "public" &&
                      post.author.visibility === "public")) &&
                    !needsReview(post) &&
                    !needsReview(post.author) && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Share ${post.title}`}
                        accessibilityState={{ disabled: sharing }}
                        disabled={sharing}
                        style={f.action}
                        onPress={() => void share(post)}
                      >
                        <Icon name="share-outline" color="#FFFFFF" size={27} />
                        <Text style={f.actionLabel}>Share</Text>
                      </Pressable>
                    )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open reporting and creator options for ${post.title}`}
                    style={f.action}
                    onPress={() => openPost(post)}
                  >
                    <Icon
                      name="ellipsis-horizontal"
                      color="#FFFFFF"
                      size={26}
                    />
                    <Text style={f.actionLabel}>Options</Text>
                  </Pressable>
                  {post.media.length > 1 && (
                    <Text style={f.caption}>{post.media.length} photos</Text>
                  )}
                </View>
              </View>
            </View>
          )}
        />
        {!posts.length && (
          <View style={[StyleSheet.absoluteFill, f.empty]}>
            <Icon
              name={videoFeed ? "videocam-outline" : "images-outline"}
              size={48}
              color="#CBC5D8"
            />
            <Text style={f.title}>
              {videoFeed ? "No videos here yet" : "No posts here yet"}
            </Text>
            <Text style={[f.description, { textAlign: "center" }]}>
              {videoFeed
                ? "Be the first to share a build in motion. Submit a video from Create; it appears here after review."
                : "Close this view to explore more creators."}
            </Text>
          </View>
        )}
        <View style={[f.top, { top: Math.max(14, insets.top + 8) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close full-screen view"
            style={f.control}
            onPress={onClose}
          >
            <Icon name="close" color="#FFFFFF" size={24} />
          </Pressable>
          <Text style={f.topLabel}>
            {videoFeed ? "VIDEOS" : "IN FOCUS"}{" "}
            {!!posts.length && (
              <Text style={f.caption}>
                {" "}
                · {index + 1} / {posts.length}
                {cursor ? "+" : ""}
              </Text>
            )}
          </Text>
          <View style={{ flexDirection: "row", gap: 5 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous post"
              accessibilityState={{ disabled: index === 0 || !posts.length }}
              disabled={index === 0 || !posts.length}
              style={[f.control, index === 0 && { opacity: 0.4 }]}
              onPress={() => go(index - 1)}
            >
              <Icon name="chevron-up" color="#FFFFFF" size={21} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                index >= posts.length - 1 && cursor
                  ? "Load more video posts"
                  : "Next post"
              }
              accessibilityState={{
                disabled: loadingMore || (index >= posts.length - 1 && !cursor),
              }}
              disabled={loadingMore || (index >= posts.length - 1 && !cursor)}
              style={[
                f.control,
                index >= posts.length - 1 && !cursor && { opacity: 0.4 },
              ]}
              onPress={() =>
                index >= posts.length - 1 ? void loadMore(true) : go(index + 1)
              }
            >
              {loadingMore ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Icon name="chevron-down" color="#FFFFFF" size={21} />
              )}
            </Pressable>
          </View>
        </View>
        {!!pageError && (
          <View style={[f.error, { top: insets.top + 75 }]}>
            <Text accessibilityRole="alert" style={f.description}>
              {pageError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading videos"
              onPress={() => void loadMore()}
              style={f.retry}
            >
              <Text style={f.detailsText}>Try loading more videos again</Text>
            </Pressable>
          </View>
        )}
        {!!error && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss notice"
            onPress={() => setError("")}
            style={[f.error, { top: insets.top + (pageError ? 178 : 75) }]}
          >
            <Text accessibilityRole="alert" style={f.description}>
              {error}
            </Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const f = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#09090E" },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    padding: 30,
  },
  retry: { minHeight: 44, justifyContent: "center", paddingTop: 8 },
  noImage: { justifyContent: "center", alignItems: "center" },
  top: {
    position: "absolute",
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  control: {
    backgroundColor: "rgba(9,9,14,.78)",
    borderRadius: 24,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  topLabel: {
    fontSize: 11,
    color: "#FFFFFF",
    fontWeight: "800",
    letterSpacing: 1,
  },
  bottom: {
    position: "absolute",
    padding: 18,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    backgroundColor: "rgba(9,9,14,.82)",
    borderRadius: 24,
  },
  author: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
  },
  creator: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  title: {
    color: "#FFFFFF",
    fontSize: 23,
    lineHeight: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  description: { color: "#E5E1EC", fontSize: 13, lineHeight: 19 },
  caption: { color: "#CBC5D8", fontSize: 11, lineHeight: 16 },
  badge: {
    color: "#FFFFFF",
    backgroundColor: "#292235",
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    overflow: "hidden",
  },
  actions: { alignItems: "center", gap: 14, width: 66 },
  action: {
    minHeight: 64,
    minWidth: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  actionLabel: {
    fontSize: 10,
    color: "#FFFFFF",
    textAlign: "center",
    fontWeight: "600",
  },
  details: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 22,
  },
  detailsText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  error: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: "#452A46",
    padding: 16,
    borderRadius: 14,
  },
});
