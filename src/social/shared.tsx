import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaSource } from "../api";
import { Avatar, Button, Empty, Icon, IconButton, useUI } from "../ui";
import type {
  ContentReview,
  CreativePost,
  CreativeStage,
  CreatorProfile,
} from "./types";
import { useSocialStyles } from "./styles";

export const stageName = (stage: CreativeStage) =>
  ({
    wip: "Work in progress",
    finished: "Finished work",
    tutorial: "How it’s made",
  })[stage];
export const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

export const needsReview = (content: ContentReview) =>
  content.reviewStatus === "pending" || content.reviewStatus === "rejected";

export function ReviewNotice({
  content,
  subject,
}: {
  content: ContentReview;
  subject: "profile" | "work" | "comment";
}) {
  const { C } = useUI();
  const x = useSocialStyles();
  if (!needsReview(content)) return null;
  const rejected = content.reviewStatus === "rejected";
  const name =
    subject === "profile" ? "Profile" : subject === "work" ? "Work" : "Comment";
  return (
    <View style={x.soft}>
      <View style={x.row}>
        <Icon
          name={rejected ? "alert-circle-outline" : "hourglass-outline"}
          color={C.blue}
          size={18}
        />
        <Text style={x.label}>
          {name} {rejected ? "not approved" : "awaiting review"}
        </Text>
      </View>
      <Text style={x.small}>
        {subject === "profile"
          ? "Your profile, public work, and comments stay hidden from other creators until your profile is approved. Your private crews are still available."
          : `Only you can see this ${subject} until it’s approved.`}
        {rejected
          ? subject === "comment"
            ? " Delete it and submit a revised comment."
            : ` Edit your ${subject} and submit it again for review.`
          : " Crewroom reviews public content before it appears to others."}
      </Text>
      {!!content.reviewReason && (
        <Text style={[x.small, { color: C.ink }]}>
          Review note: {content.reviewReason}
        </Text>
      )}
    </View>
  );
}

export function useResource<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList,
) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const serial = useRef(0);
  const reload = useCallback(async () => {
    const current = ++serial.current;
    setLoading(true);
    setError("");
    try {
      const result = await loaderRef.current();
      if (current === serial.current) setData(result);
      return result;
    } catch (e) {
      if (current === serial.current) setError(messageOf(e));
      return null;
    } finally {
      if (current === serial.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setData(null);
    void reload();
    return () => {
      serial.current++;
    };
  }, deps);
  return { data, setData, loading, error, reload };
}

export function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  const { C, s } = useUI();
  const x = useSocialStyles();
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={s.error}>
      <Text style={s.errorText}>{message}</Text>
      {retry && (
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={x.link}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Spinner() {
  const { C, s } = useUI();
  return (
    <View style={{ padding: 30, alignItems: "center" }}>
      <ActivityIndicator color={C.blue} />
    </View>
  );
}

export function AccountPrompt({
  onPress,
  title = "A little more connected",
  text = "Create an account to save work, follow creators, and find your next collaboration.",
}: {
  onPress: () => void;
  title?: string;
  text?: string;
}) {
  return (
    <Empty
      icon="people-outline"
      title={title}
      text={text}
      action="Create an account or sign in"
      onPress={onPress}
    />
  );
}

export function Choice({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const x = useSocialStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-pressed={active}
      onPress={onPress}
      style={[x.chip, active && x.chipActive]}
    >
      <Text style={[x.chipText, active && x.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function ToggleButton({
  title,
  pressed,
  disabled = false,
  secondary = true,
  icon,
  onPress,
}: {
  title: string;
  pressed: boolean;
  disabled?: boolean;
  secondary?: boolean;
  icon: React.ComponentProps<typeof Icon>["name"];
  onPress: () => void;
}) {
  const { C, s } = useUI();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: pressed, disabled }}
      aria-pressed={pressed}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed: touching }) => [
        s.button,
        secondary && s.secondary,
        { opacity: disabled ? 0.45 : touching ? 0.8 : 1 },
      ]}
    >
      <Icon name={icon} size={18} color={secondary ? C.blue : C.onAccent} />
      <Text style={[s.buttonText, secondary && { color: C.blue }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Sheet({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const { C, s } = useUI();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.modalBackdrop}
      >
        <View
          style={[s.modal, { paddingBottom: insets.bottom, maxHeight: "94%" }]}
        >
          <View style={s.modalHeader}>
            <Text style={[s.h2, { flex: 1 }]}>{title}</Text>
            <IconButton
              name="close"
              label="Close dialog"
              onPress={() => {
                if (!busy) onClose();
              }}
            />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[s.modalBody, { gap: 20 }]}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ProfileLink({
  profile,
  onPress,
}: {
  profile: CreatorProfile;
  onPress: () => void;
}) {
  const { C, s } = useUI();
  const x = useSocialStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${profile.displayName}'s profile`}
      onPress={onPress}
      style={x.authorButton}
    >
      <Avatar
        name={profile.displayName}
        size={33}
        color={profile.isExample ? C.lavender : C.peach}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={x.authorName}>
          {profile.displayName}
        </Text>
        <Text numberOfLines={1} style={[x.small, { fontSize: 10 }]}>
          {profile.isExample
            ? "Fictional creator"
            : profile.roles.join(" · ") || `@${profile.handle}`}
        </Text>
      </View>
    </Pressable>
  );
}

export function WorkCard({
  post,
  onOpen,
  onProfile,
  onSave,
}: {
  post: CreativePost;
  onOpen: () => void;
  onProfile: () => void;
  onSave: (post: CreativePost) => Promise<void>;
}) {
  const { C, s } = useUI();
  const x = useSocialStyles();
  const [busy, setBusy] = useState(false);
  const image = post.media[0];
  return (
    <View style={x.postCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${post.title}`}
        onPress={onOpen}
      >
        {image ? (
          <Image
            source={mediaSource(image)}
            accessibilityLabel={image.alt || post.title}
            style={[
              x.image,
              {
                aspectRatio: Math.max(
                  0.86,
                  Math.min(1.35, image.width / image.height || 1),
                ),
              },
            ]}
            resizeMode="cover"
          />
        ) : (
          <View style={x.imageEmpty}>
            <Icon name="images-outline" size={32} color={C.blue} />
            <Text style={x.small}>A new idea, taking shape</Text>
          </View>
        )}
        <View style={x.imageBadges}>
          <View style={x.imageBadge}>
            <Text style={x.badgeText}>{stageName(post.stage)}</Text>
          </View>
          {post.visibility === "private" && (
            <View style={x.imageBadge}>
              <Text style={x.badgeText}>Private draft</Text>
            </View>
          )}
          {post.visibility === "public" &&
            (needsReview(post) || needsReview(post.author)) && (
            <View style={x.imageBadge}>
              <Text style={x.badgeText}>
                {needsReview(post)
                  ? post.reviewStatus === "rejected"
                    ? "Not approved"
                    : "Awaiting review"
                  : post.author.reviewStatus === "rejected"
                    ? "Profile not approved"
                    : "Profile awaiting review"}
              </Text>
            </View>
          )}
          {post.isExample && (
            <View style={x.imageBadge}>
              <Text style={x.badgeText}>AI-illustrated example</Text>
            </View>
          )}
        </View>
      </Pressable>
      <View style={x.postBody}>
        <View style={{ gap: 5 }}>
          <Text style={x.eyebrow}>{post.fandom || "Original work"}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onOpen}
            style={{ minHeight: 32 }}
          >
            <Text style={x.postTitle}>{post.title}</Text>
          </Pressable>
          {post.character ? (
            <Text style={x.small}>{post.character}</Text>
          ) : null}
        </View>
        {post.opportunity && !post.isExample && (
          <View style={x.row}>
            <View style={x.unread} />
            <Text style={[x.small, { color: C.green, flex: 1 }]}>
              Looking for {post.opportunity.role}
              {post.opportunity.city ? ` · ${post.opportunity.city}` : ""}
            </Text>
          </View>
        )}
        <View style={x.toolbar}>
          <ProfileLink profile={post.author} onPress={onProfile} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              post.viewerSaved ? `Unsave ${post.title}` : `Save ${post.title}`
            }
            accessibilityState={{ disabled: busy, selected: post.viewerSaved }}
            aria-pressed={post.viewerSaved}
            aria-disabled={busy}
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void onSave(post).finally(() => setBusy(false));
            }}
            style={x.iconButton}
          >
            {busy ? (
              <ActivityIndicator color={C.blue} />
            ) : (
              <Icon
                name={post.viewerSaved ? "bookmark" : "bookmark-outline"}
                size={20}
                color={post.viewerSaved ? C.blue : C.ink}
              />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function WorkGrid({
  posts,
  wide,
  onOpen,
  onProfile,
  onSave,
}: {
  posts: CreativePost[];
  wide: boolean;
  onOpen: (id: string) => void;
  onProfile: (handle: string) => void;
  onSave: (post: CreativePost) => Promise<void>;
}) {
  const x = useSocialStyles();
  return (
    <View style={x.grid}>
      {posts.map((post) => (
        <View key={post.id} style={{ width: wide ? "48.7%" : "100%" }}>
          <WorkCard
            post={post}
            onOpen={() => onOpen(post.id)}
            onProfile={() => onProfile(post.author.handle)}
            onSave={onSave}
          />
        </View>
      ))}
    </View>
  );
}
