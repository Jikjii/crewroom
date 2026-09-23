import VideoPlayer from "./VideoPlayer";
import React, { useMemo, useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { getPublicWebUrl, mediaSource, socialApi } from "../api";
import type { User } from "../types";
import type { Palette } from "../theme";
import { Avatar, Button, Field, Icon, IconButton, Tag, useUI } from "../ui";
import type { CreativePost, CreatorProfile, ReportInput } from "./types";
import {
  ErrorNotice,
  ProfileLink,
  ReviewNotice,
  ToggleButton,
  Spinner,
  messageOf,
  needsReview,
  publicationMessage,
  stageName,
  useResource,
  isScreening,
  useScreeningRefresh,
} from "./shared";
import { useSocialStyles } from "./styles";
import { useModerationPolicy } from "./moderationPolicy";

interface Props {
  id: string;
  user: User | null;
  wide: boolean;
  revision: number;
  playbackSuspended?: boolean;
  onProfile: (handle: string) => void;
  onSave: (post: CreativePost) => Promise<void>;
  onEdit: (post: CreativePost) => void;
  onRequest: (profile: CreatorProfile, post: CreativePost) => void;
  onReport: (target: Pick<ReportInput, "targetId" | "targetType">) => void;
  onBlock: (profile: CreatorProfile) => void;
  ensurePublic: () => Promise<boolean>;
  onChanged: () => void;
  onDeleted: () => void;
  notify: (message: string) => void;
}
export default function PostDetail({
  id,
  user,
  wide,
  revision,
  playbackSuspended = false,
  onProfile,
  onSave,
  onEdit,
  onRequest,
  onReport,
  onBlock,
  ensurePublic,
  onChanged,
  onDeleted,
  notify,
}: Props) {
  const { C } = useUI();
  const x = useSocialStyles();
  const moderation = useModerationPolicy();
  const v = useMemo(() => detailStyles(C), [C]);
  const scrollRef = useRef<ScrollView>(null);
  const commentsY = useRef(0);
  const resource = useResource(
    () => socialApi.getPost(id),
    [id, revision, user?.id],
  );
  const [selected, setSelected] = useState(0),
    [comment, setComment] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false);
  const lock = useRef(false);
  const post = resource.data?.post,
    comments = resource.data?.comments || [],
    own = !!user && post?.author.userId === user.id;
  const reviewBlocked =
    !!post && (needsReview(post) || needsReview(post.author));
  useScreeningRefresh(Boolean((own && (isScreening(post) || isScreening(post?.author))) ||
    comments.some(c => c.author.userId === user?.id && isScreening(c))), resource.reload);
  const shareable =
    !!post &&
    (post.isExample ||
      (post.visibility === "public" &&
        post.author.visibility === "public" &&
        !user?.isDemo));
  const run = async (key: string, action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  const addComment = async () => {
    if (!post || !comment.trim()) return;
    if (!(await ensurePublic())) return;
    await run("comment", async () => {
      const saved = await socialApi.addComment(post.id, comment);
      setComment("");
      await resource.reload();
      onChanged();
      notify(publicationMessage(saved, "Comment"));
    });
  };
  const follow = async () => {
    if (!post || post.isExample || own || lock.current) return;
    if (!post.author.viewerFollowing && !(await ensurePublic())) return;
    await run("follow", async () => {
      await socialApi.followProfile(
        post.author.userId,
        !post.author.viewerFollowing,
      );
      await resource.reload();
      onChanged();
    });
  };
  const share = async () => {
    if (!post || !shareable || reviewBlocked) return;
    await run("share", async () => {
      const url = getPublicWebUrl(`/p/${encodeURIComponent(post.id)}`);
      if (Platform.OS === "web") {
        await Clipboard.setStringAsync(url);
        notify("Public project link copied.");
      } else
        await Share.share({
          message: `${post.title} on Crewroom${post.isExample ? " · fictional AI-illustrated example" : ""}\n${url}`,
        });
    });
  };
  if (resource.loading && !post) return <Spinner />;
  if (!post)
    return (
      <View style={x.content}>
        <ErrorNotice
          message={resource.error || "This work is no longer available."}
          retry={() => void resource.reload()}
        />
      </View>
    );
  const image =
    post.media[Math.min(selected, Math.max(0, post.media.length - 1))];
  return (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        x.content,
        { gap: 22 },
        wide && { paddingHorizontal: 30 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={resource.loading && !!post}
          onRefresh={() => void resource.reload()}
          tintColor={C.blue}
        />
      }
    >
      <View style={[x.toolbar, { flexWrap: "wrap" }]}>
        <View style={[x.row, { flexShrink: 1 }]}>
          <Icon
            name={
              post.stage === "tutorial"
                ? "construct-outline"
                : "sparkles-outline"
            }
            color={C.blue}
            size={19}
          />
          <Text style={v.showcaseTitle}>
            {post.stage === "tutorial" ? "Behind the build" : "Build showcase"}
          </Text>
        </View>
        <Tag tone={post.visibility === "private" ? "muted" : "blue"}>
          {post.visibility === "private"
            ? "Private draft"
            : stageName(post.stage)}
        </Tag>
      </View>
      <ErrorNotice message={error || resource.error} />
      {own && !user?.isDemo && (
        <>
          <ReviewNotice content={post} subject="work" />
          {post.visibility === "public" && (
            <ReviewNotice content={post.author} subject="profile" />
          )}
          {post.visibility === "public" &&
            post.author.visibility === "private" && (
              <View style={x.soft}>
                <Text style={x.label}>Hidden by your private profile</Text>
                <Text style={x.small}>
                  Only you can see this work. Make your profile available for public
                  sharing when you’re ready.
                </Text>
              </View>
            )}
        </>
      )}
      {image ? (
        <View style={{ gap: 12 }}>
          <View style={v.heroImage}>
            {image.kind === "video" ? (
              <VideoPlayer
                key={image.id}
                media={image}
                controls
                active={false}
                suspended={
                  playbackSuspended || busy === "share" || confirmDelete
                }
                style={{
                  width: "100%",
                  aspectRatio: Math.max(
                    0.7,
                    Math.min(1.8, image.width / image.height || 1),
                  ),
                  maxHeight: wide ? 640 : undefined,
                  borderRadius: 22,
                }}
              />
            ) : (
              <Image
                source={mediaSource(image)}
                accessibilityLabel={image.alt || post.title}
                resizeMode="contain"
                style={[
                  x.image,
                  {
                    aspectRatio: Math.max(
                      0.7,
                      Math.min(1.8, image.width / image.height || 1),
                    ),
                    maxHeight: wide ? 640 : undefined,
                    borderRadius: 22,
                    backgroundColor: C.image,
                  },
                ]}
              />
            )}
            {post.media.length > 1 && (
              <View style={v.imageCount}>
                <Icon name="images-outline" color="#FFFFFF" size={14} />
                <Text style={v.imageCountText}>
                  {Math.min(selected + 1, post.media.length)} /{" "}
                  {post.media.length}
                </Text>
              </View>
            )}
          </View>
          {post.media.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[x.row, { paddingVertical: 2 }]}
            >
              {post.media.map((asset, index) => (
                <Pressable
                  key={asset.id}
                  accessibilityRole="button"
                  accessibilityLabel={`View image ${index + 1}`}
                  accessibilityState={{ selected: index === selected }}
                  aria-pressed={index === selected}
                  onPress={() => setSelected(index)}
                  style={{
                    borderWidth: 2,
                    borderColor: index === selected ? C.blue : "transparent",
                    padding: 3,
                    borderRadius: 12,
                  }}
                >
                  <Image
                    source={mediaSource(asset)}
                    accessibilityLabel={asset.alt || `Image ${index + 1}`}
                    style={{ width: 63, height: 63, borderRadius: 8 }}
                  />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : (
        <View style={x.imageEmpty}>
          <Icon name="images-outline" size={35} color={C.blue} />
          <Text style={x.body}>An idea, waiting for its first image.</Text>
        </View>
      )}
      <View style={[x.toolbar, { flexWrap: "wrap" }]}>
        <ProfileLink
          profile={post.author}
          onPress={() => onProfile(post.author.handle)}
        />
        {!own && !post.isExample && (
          <ToggleButton
            title={
              busy === "follow"
                ? "One moment…"
                : post.author.viewerFollowing
                  ? "Following"
                  : "Follow"
            }
            pressed={post.author.viewerFollowing}
            secondary={post.author.viewerFollowing}
            disabled={!!busy}
            icon={post.author.viewerFollowing ? "checkmark" : "add"}
            onPress={() => void follow()}
          />
        )}
      </View>
      {post.isExample && (
        <View style={x.soft}>
          <Text style={x.label}>An imagined project, a real possibility</Text>
          <Text style={x.small}>
            This is an AI-illustrated fictional example, not a real person’s
            cosplay or an available collaboration. You can save it privately;
            comments, follows, and requests are unavailable.
          </Text>
        </View>
      )}
      {user?.isDemo && own && (
        <View style={x.soft}>
          <Text style={x.small}>
            Only you can see this demo work. It remains a private draft when you
            save your account.
          </Text>
        </View>
      )}
      <View style={{ gap: 12 }}>
        <Text style={[v.title, wide && { fontSize: 38, lineHeight: 43 }]}>
          {post.title}
        </Text>
        <View style={x.wrap}>
          <View style={v.subjectTag}>
            <Text style={v.subjectText}>{post.fandom || "Original work"}</Text>
          </View>
          {!!post.character && (
            <View style={[v.subjectTag, { backgroundColor: C.subdued }]}>
              <Text style={[v.subjectText, { color: C.muted }]}>
                {post.character}
              </Text>
            </View>
          )}
        </View>
      </View>
      <View style={[x.row, { flexWrap: "wrap" }]}>
        {!post.isExample && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${comments.length} comments`}
            onPress={() =>
              scrollRef.current?.scrollTo({
                y: commentsY.current,
                animated: true,
              })
            }
            style={v.commentPill}
          >
            <Icon name="chatbubble-outline" color={C.blue} size={19} />
            <Text style={v.commentCount}>{comments.length}</Text>
            <Text style={x.small}>Comments</Text>
          </Pressable>
        )}
        <ToggleButton
          title={post.viewerSaved ? "Saved privately" : "Save for later"}
          pressed={post.viewerSaved}
          secondary
          icon={post.viewerSaved ? "bookmark" : "bookmark-outline"}
          disabled={!!busy}
          onPress={() => void run("save", () => onSave(post))}
        />
        {shareable && (
          <Button
            title={
              reviewBlocked
                ? "Share after approval"
                : Platform.OS === "web"
                  ? "Copy public link"
                  : "Share work"
            }
            secondary
            icon="share-outline"
            disabled={!!busy || reviewBlocked}
            onPress={() => void share()}
          />
        )}
        {own && (
          <Button
            title={
              post.visibility === "private"
                ? "Edit / submit draft"
                : "Edit work"
            }
            secondary
            icon="create-outline"
            onPress={() => onEdit(post)}
          />
        )}
      </View>
      {!!post.body && (
        <View style={v.breakdown}>
          <View style={x.row}>
            <Icon name="construct-outline" color={C.blue} size={23} />
            <Text style={[x.sectionTitle, { flex: 1 }]}>
              {post.stage === "tutorial"
                ? "How it came together"
                : "Behind the work"}
            </Text>
          </View>
          <Text style={[x.body, { color: C.ink, lineHeight: 25 }]}>
            {post.body}
          </Text>
        </View>
      )}
      {post.credits.length > 0 && (
        <View style={v.breakdown}>
          <View style={x.row}>
            <Icon name="people-outline" color={C.blue} size={23} />
            <Text style={x.sectionTitle}>Made with</Text>
          </View>
          {post.credits.map((credit, index) => (
            <View
              key={`${credit.name}-${index}`}
              style={[x.row, { paddingVertical: 4 }]}
            >
              <Avatar
                name={credit.name}
                size={35}
                color={index % 2 ? C.peach : C.lavender}
              />
              <View style={x.grow}>
                <Text style={x.label}>{credit.name}</Text>
                <Text style={x.small}>{credit.role}</Text>
              </View>
            </View>
          ))}
          <Text style={x.small}>Credits supplied by the uploader.</Text>
        </View>
      )}
      {post.opportunity && (
        <View
          style={[
            v.breakdown,
            { backgroundColor: C.pale, borderColor: C.selectionBorder },
          ]}
        >
          <View style={x.row}>
            <Icon name="people-outline" color={C.blue} />
            <Text style={[x.sectionTitle, { flex: 1 }]}>
              {post.isExample
                ? "An example collaboration"
                : "The next chapter could be together"}
            </Text>
          </View>
          <Text style={x.body}>Looking for {post.opportunity.role}</Text>
          <Text style={x.small}>
            {[
              post.opportunity.city,
              post.opportunity.eventName,
              post.opportunity.date,
            ]
              .filter(Boolean)
              .join(" · ") || "Details to work out together"}
          </Text>
          {!own && !post.isExample && (
            <Button
              title="Suggest a collaboration"
              icon="paper-plane-outline"
              onPress={() => onRequest(post.author, post)}
            />
          )}
        </View>
      )}
      {!post.opportunity &&
        !own &&
        !post.isExample &&
        post.author.openToCollab && (
          <Button
            title={`Create with ${post.author.displayName}`}
            secondary
            icon="people-outline"
            onPress={() => onRequest(post.author, post)}
          />
        )}
      {!post.isExample && (
        <View
          style={x.section}
          onLayout={(event) => {
            commentsY.current = event.nativeEvent.layout.y;
          }}
        >
          <View style={x.row}>
            <Text style={x.sectionTitle}>Comments</Text>
            <View style={v.countBadge}>
              <Text style={v.countBadgeText}>{comments.length}</Text>
            </View>
          </View>
          <Text style={x.body}>
            Ask about a technique. Appreciate the detail. Talk to the person
            behind the work.
          </Text>
          {comments.map((item) => (
            <View key={item.id} style={v.comment}>
              <View style={x.toolbar}>
                <ProfileLink
                  profile={item.author}
                  onPress={() => onProfile(item.author.handle)}
                />
                {user?.id === item.author.userId || own ? (
                  <IconButton
                    name="trash-outline"
                    label="Delete comment"
                    onPress={() =>
                      void run(item.id, async () => {
                        await socialApi.deleteComment(item.id);
                        await resource.reload();
                        onChanged();
                      })
                    }
                  />
                ) : (
                  <IconButton
                    name="flag-outline"
                    label={`Report comment by ${item.author.displayName}`}
                    onPress={() =>
                      onReport({ targetType: "comment", targetId: item.id })
                    }
                  />
                )}
              </View>
              <Text style={[x.body, { color: C.ink }]}>{item.body}</Text>
              {user?.id === item.author.userId && (
                <ReviewNotice
                  content={needsReview(item) ? item : item.author}
                  subject={needsReview(item) ? "comment" : "profile"}
                />
              )}
              <Text style={x.small}>
                {new Date(item.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </View>
          ))}
          <View style={x.card}>
            <Field
              label="Add to the conversation"
              value={comment}
              onChange={setComment}
              multiline
              placeholder="What caught your eye?"
            />
            <Button
              title={
                busy === "comment" ? "Posting…" : "Post comment"
              }
              disabled={!!busy || !comment.trim()}
              onPress={() => void addComment()}
            />
            <Text style={x.small}>
              {moderation.automatic
                ? "Comments publish when safety checks pass. Flagged comments may need review."
                : "Comments appear to others once approved."} You can see and
              delete your own comment while it awaits approval.
            </Text>
          </View>
        </View>
      )}
      {own ? (
        <View style={{ gap: 12 }}>
          {confirmDelete ? (
            <View style={x.card}>
              <Text style={x.label}>Delete this post?</Text>
              <Text style={x.small}>
                Its public page and comments will be unavailable. Your private
                crew plans are unchanged.
              </Text>
              <Button
                title={busy === "delete" ? "Deleting…" : "Delete this post"}
                disabled={!!busy}
                onPress={() =>
                  void run("delete", async () => {
                    await socialApi.deletePost(post.id);
                    onDeleted();
                  })
                }
              />
              <Button
                title="Keep my work"
                secondary
                disabled={!!busy}
                onPress={() => setConfirmDelete(false)}
              />
            </View>
          ) : (
            <Button
              title="Delete post"
              secondary
              small
              onPress={() => setConfirmDelete(true)}
            />
          )}
        </View>
      ) : (
        !post.isExample && (
          <View style={x.wrap}>
            <Button
              title="Report work"
              secondary
              small
              onPress={() =>
                onReport({ targetType: "post", targetId: post.id })
              }
            />
            <Button
              title="Block creator"
              secondary
              small
              onPress={() => onBlock(post.author)}
            />
          </View>
        )
      )}
    </ScrollView>
  );
}

const detailStyles = (C: Palette) =>
  StyleSheet.create({
    showcaseTitle: {
      color: C.ink,
      fontSize: 14,
      fontWeight: "800",
      letterSpacing: -0.2,
    },
    heroImage: {
      borderRadius: 22,
      overflow: "hidden",
      backgroundColor: C.image,
    },
    imageCount: {
      position: "absolute",
      right: 14,
      bottom: 14,
      paddingHorizontal: 10,
      paddingVertical: 7,
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      borderRadius: 20,
      backgroundColor: "rgba(0,0,0,0.7)",
    },
    imageCountText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
    title: {
      color: C.ink,
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.8,
      fontWeight: "800",
    },
    subjectTag: {
      backgroundColor: C.pale,
      borderRadius: 30,
      paddingHorizontal: 13,
      paddingVertical: 9,
      maxWidth: "100%",
    },
    subjectText: {
      color: C.blue,
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.35,
    },
    commentPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 15,
      paddingVertical: 9,
      backgroundColor: C.white,
      borderWidth: 1,
      borderColor: C.line,
      borderRadius: 30,
    },
    commentCount: { color: C.ink, fontSize: 15, fontWeight: "800" },
    breakdown: {
      padding: 20,
      borderRadius: 22,
      backgroundColor: C.white,
      borderWidth: 1,
      borderColor: C.line,
      gap: 16,
    },
    countBadge: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: C.pale,
    },
    countBadgeText: { color: C.blue, fontSize: 12, fontWeight: "700" },
    comment: {
      paddingVertical: 17,
      borderBottomWidth: 1,
      borderBottomColor: C.line,
      gap: 12,
    },
  });
