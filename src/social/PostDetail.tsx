import React, { useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { getPublicWebUrl, mediaSource, socialApi } from "../api";
import type { User } from "../types";
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
  stageName,
  useResource,
} from "./shared";
import { useSocialStyles } from "./styles";

interface Props {
  id: string;
  user: User | null;
  wide: boolean;
  revision: number;
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
  const { C, s } = useUI();
  const x = useSocialStyles();
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
  const reviewBlocked = !!post && (needsReview(post) || needsReview(post.author));
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
      notify(
        saved.reviewStatus === "pending"
          ? "Comment submitted for review. Only you can see it until approved."
          : "Comment saved.",
      );
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
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[x.content, wide && { paddingHorizontal: 30 }]}
      refreshControl={
        <RefreshControl
          refreshing={resource.loading && !!post}
          onRefresh={() => void resource.reload()}
          tintColor={C.blue}
        />
      }
    >
      <View style={x.toolbar}>
        <ProfileLink
          profile={post.author}
          onPress={() => onProfile(post.author.handle)}
        />
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
          {post.visibility === "public" && post.author.visibility === "private" && (
            <View style={x.soft}>
              <Text style={x.label}>Hidden by your private profile</Text>
              <Text style={x.small}>
                Only you can see this work. Submit your profile for public sharing
                when you’re ready.
              </Text>
            </View>
          )}
        </>
      )}
      {image ? (
        <View style={{ gap: 12 }}>
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
                borderRadius: 23,
                backgroundColor: C.image,
              },
            ]}
          />
          {post.media.length > 1 && (
            <View style={x.row}>
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
            </View>
          )}
        </View>
      ) : (
        <View style={x.imageEmpty}>
          <Icon name="images-outline" size={35} color={C.blue} />
          <Text style={x.body}>An idea, waiting for its first image.</Text>
        </View>
      )}
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
      <View style={{ gap: 10 }}>
        <Text style={x.eyebrow}>{post.fandom || "Original work"}</Text>
        <Text style={x.title}>{post.title}</Text>
        {post.character ? <Text style={x.body}>{post.character}</Text> : null}
      </View>
      <View style={[x.row, { flexWrap: "wrap" }]}>
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
                : Platform.OS === "web" ? "Copy public link" : "Share work"
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
        <View style={x.section}>
          <Text style={x.sectionTitle}>
            {post.stage === "tutorial"
              ? "How it came together"
              : "Behind the work"}
          </Text>
          <Text style={[x.body, { color: C.ink, lineHeight: 25 }]}>
            {post.body}
          </Text>
        </View>
      )}
      {post.credits.length > 0 && (
        <View style={x.card}>
          <Text style={x.sectionTitle}>Made with good people</Text>
          {post.credits.map((credit, index) => (
            <View key={`${credit.name}-${index}`} style={x.row}>
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
          style={[x.card, { backgroundColor: C.pale, borderColor: C.pale }]}
        >
          <View style={x.row}>
            <Icon name="people-outline" color={C.blue} />
            <Text style={x.sectionTitle}>
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
        <View style={x.section}>
          <Text style={x.sectionTitle}>
            A little conversation
            {comments.length ? ` (${comments.length})` : ""}
          </Text>
          <Text style={x.body}>
            Ask about a technique. Appreciate the detail. Talk to the person
            behind the work.
          </Text>
          {comments.map((item) => (
            <View key={item.id} style={x.card}>
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
              title={busy === "comment" ? "Submitting…" : "Submit comment for review"}
              disabled={!!busy || !comment.trim()}
              onPress={() => void addComment()}
            />
            <Text style={x.small}>
              Comments appear to others after review. You can see and delete your
              own comment while it awaits approval.
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
