import React, { useMemo, useRef, useState } from "react";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { getPublicWebUrl, mediaSource, socialApi } from "../api";
import { isScreening, useScreeningRefresh } from './shared';
import type { User } from "../types";
import type { Palette } from "../theme";
import { Avatar, Button, Empty, Field, Icon, Tag, useUI } from "../ui";
import type {
  CreativePost,
  CreatorProfile,
  ProfileResult,
  SocialVisibility,
} from "./types";
import {
  AccountPrompt,
  ErrorNotice,
  ReviewNotice,
  Sheet,
  Spinner,
  WorkGrid,
  ToggleButton,
  messageOf,
  needsReview,
  reviewLabel,
  useResource,
} from "./shared";
import { useSocialStyles } from "./styles";
import { useModerationPolicy } from "./moderationPolicy";

interface Props {
  user: User | null;
  handle?: string;
  wide: boolean;
  revision: number;
  onAccount: () => void;
  onPost: (id: string) => void;
  onProfile: (handle: string) => void;
  onSave: (post: CreativePost) => Promise<void>;
  onCrews: () => void;
  onCreate: () => void;
  onEdit: (profile: CreatorProfile) => void;
  onSettings: () => void;
  onRequest: (profile: CreatorProfile) => void;
  onReport: (profile: CreatorProfile) => void;
  onBlock: (profile: CreatorProfile) => void;
  ensurePublic: () => Promise<boolean>;
  onChanged: () => void;
}
export default function Profile({
  user,
  handle,
  wide,
  revision,
  onAccount,
  onPost,
  onProfile,
  onSave,
  onCrews,
  onCreate,
  onEdit,
  onSettings,
  onRequest,
  onReport,
  onBlock,
  ensurePublic,
  onChanged,
}: Props) {
  const { C } = useUI();
  const x = useSocialStyles();
  const v = useMemo(() => profileStyles(C), [C]);
  const resource = useResource<ProfileResult | null>(async () => {
    if (handle) return socialApi.getProfile(handle);
    if (!user) return null;
    const me = await socialApi.getMe();
    return socialApi.getProfile(me.handle);
  }, [handle, user?.id, user?.isDemo, revision]);
  const profile = resource.data?.profile,
    posts = resource.data?.posts || [];
  const own = !!user && profile?.userId === user.id;
  useScreeningRefresh(own && (isScreening(profile) || posts.some(isScreening)), resource.reload);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [workTab, setWorkTab] = useState<"published" | "drafts">("published");
  const lock = useRef(false);
  const follow = async () => {
    if (!profile || profile.isExample || lock.current) return;
    if (!profile.viewerFollowing && !(await ensurePublic())) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await socialApi.followProfile(profile.userId, !profile.viewerFollowing);
      await resource.reload();
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const openLink = (url: string) => {
    void Linking.openURL(url).catch((e) => setError(messageOf(e)));
  };
  const shareProfile = async () => {
    if (
      !profile ||
      lock.current ||
      profile.visibility !== "public" ||
      needsReview(profile) ||
      (own && user?.isDemo)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const url = getPublicWebUrl(`/u/${encodeURIComponent(profile.handle)}`);
      if (Platform.OS === "web") {
        await Clipboard.setStringAsync(url);
        setCopied(true);
      } else {
        await Share.share({
          message: `${profile.displayName} on Crewroom${profile.isExample ? " · fictional example creator" : ""}\n${url}`,
        });
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const visible = own
    ? posts.filter((post) =>
        workTab === "drafts"
          ? post.visibility === "private"
          : post.visibility === "public",
      )
    : posts;
  const coverPost = posts.find(
    (post) =>
      post.media.length > 0 &&
      post.visibility === "public" &&
      !needsReview(post) &&
      !needsReview(post.author),
  );
  const cover = coverPost?.media[0];
  return (
    <ScrollView
      contentContainerStyle={[
        x.content,
        { gap: 22 },
        wide && { paddingHorizontal: 30 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={resource.loading && !!resource.data}
          onRefresh={() => void resource.reload()}
          tintColor={C.blue}
        />
      }
    >
      {!user && !handle ? (
        <AccountPrompt
          title="Make a little space for your work"
          text="Create a profile, keep private drafts, and publish your work when you’re ready."
          onPress={onAccount}
        />
      ) : resource.loading && !profile ? (
        <Spinner />
      ) : (
        <>
          <ErrorNotice
            message={resource.error}
            retry={() => void resource.reload()}
          />
          {profile && (
            <>
              <View style={v.hero}>
                {cover && coverPost ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open portfolio work: ${coverPost.title}`}
                    onPress={() => onPost(coverPost.id)}
                    style={[v.cover, { height: wide ? 260 : 190 }]}
                  >
                    <Image
                      source={mediaSource(cover, { poster: true })}
                      accessibilityLabel={cover.alt || coverPost.title}
                      resizeMode="cover"
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={v.coverLabel}>
                      <Icon name="images-outline" color="#FFFFFF" size={13} />
                      <Text numberOfLines={1} style={v.coverLabelText}>
                        From this portfolio · {coverPost.title}
                      </Text>
                    </View>
                  </Pressable>
                ) : (
                  <View
                    style={[
                      v.cover,
                      v.emptyCover,
                      { height: wide ? 200 : 150 },
                    ]}
                  >
                    <View style={v.coverCircle} />
                    <Icon name="sparkles-outline" color={C.blue} size={34} />
                    <Text style={v.coverTitle}>A world of your own.</Text>
                  </View>
                )}
                <View style={v.profileBody}>
                  <View style={v.identityTop}>
                    <View style={v.avatarRing}>
                      <Avatar
                        name={profile.displayName}
                        size={82}
                        color={C.lavender}
                      />
                    </View>
                    <View style={v.profileStatus}>
                      {profile.isExample ? (
                        <Tag tone="muted">Fictional example</Tag>
                      ) : own ? (
                        <Tag
                          tone={
                            needsReview(profile)
                              ? "orange"
                              : profile.visibility === "public" && !user?.isDemo
                                ? "green"
                                : "muted"
                          }
                        >
                          {user?.isDemo
                            ? "Demo profile"
                            : needsReview(profile)
                              ? reviewLabel(profile)
                              : profile.visibility === "public"
                                ? "Public profile"
                                : "Private profile"}
                        </Tag>
                      ) : profile.openToCollab ? (
                        <Tag tone="green">Open to creating</Tag>
                      ) : null}
                    </View>
                  </View>
                  <View style={{ gap: 7 }}>
                    <Text
                      style={[v.name, wide && { fontSize: 38, lineHeight: 44 }]}
                    >
                      {profile.displayName}
                    </Text>
                    <Text style={v.handle}>@{profile.handle}</Text>
                    {!!profile.city && (
                      <View style={x.row}>
                        <Icon
                          name="location-outline"
                          size={15}
                          color={C.muted}
                        />
                        <Text style={x.small}>{profile.city}</Text>
                      </View>
                    )}
                  </View>
                  {!profile.isExample && (
                    <View style={v.stats}>
                      <View style={v.stat}>
                        <Text style={v.statValue}>
                          {profile.projectCount.toLocaleString()}
                        </Text>
                        <Text style={v.statLabel}>
                          {profile.projectCount === 1 ? "Project" : "Projects"}
                        </Text>
                      </View>
                      <View style={v.statDivider} />
                      <View style={v.stat}>
                        <Text style={v.statValue}>
                          {profile.followerCount.toLocaleString()}
                        </Text>
                        <Text style={v.statLabel}>
                          {profile.followerCount === 1
                            ? "Follower"
                            : "Followers"}
                        </Text>
                      </View>
                    </View>
                  )}
                  {profile.bio ? (
                    <Text style={v.bio}>{profile.bio}</Text>
                  ) : own ? (
                    <Text style={x.body}>
                      Tell people about the person behind the work. Your profile
                      starts private.
                    </Text>
                  ) : null}
                  <View style={x.wrap}>
                    {profile.roles.map((role) => (
                      <Tag key={role} tone="muted">
                        {role}
                      </Tag>
                    ))}
                  </View>
                  {profile.fandoms.length > 0 && (
                    <View style={x.wrap}>
                      {profile.fandoms.map((fandom) => (
                        <View key={fandom} style={v.fandom}>
                          <Text style={v.fandomText}>{fandom}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={x.wrap}>
                    {!!profile.websiteUrl && (
                      <Button
                        title="Website"
                        small
                        secondary
                        icon="link-outline"
                        onPress={() => openLink(profile.websiteUrl)}
                      />
                    )}
                    {!!profile.instagramUrl && (
                      <Button
                        title="Instagram"
                        small
                        secondary
                        icon="logo-instagram"
                        onPress={() => openLink(profile.instagramUrl)}
                      />
                    )}
                    {profile.visibility === "public" &&
                      !(own && user?.isDemo) && (
                        <Button
                          title={
                            needsReview(profile)
                              ? "Share after approval"
                              : Platform.OS === "web"
                                ? copied
                                  ? "Profile link copied"
                                  : "Copy profile link"
                                : "Share profile"
                          }
                          small
                          secondary
                          disabled={busy || needsReview(profile)}
                          icon="share-outline"
                          onPress={() => void shareProfile()}
                        />
                      )}
                  </View>
                  {own ? (
                    <View style={[x.row, { flexWrap: "wrap" }]}>
                      <Button
                        title="Edit profile"
                        icon="create-outline"
                        onPress={() => onEdit(profile)}
                      />
                      <Button
                        title="Settings & export"
                        secondary
                        icon="options-outline"
                        onPress={onSettings}
                      />
                    </View>
                  ) : profile.isExample ? (
                    <Text style={x.small}>
                      This creator and their AI-illustrated projects are
                      fictional. Following, comments, and collaboration requests
                      are unavailable.
                    </Text>
                  ) : (
                    <View style={[x.row, { flexWrap: "wrap" }]}>
                      <ToggleButton
                        title={
                          busy
                            ? "One moment…"
                            : profile.viewerFollowing
                              ? "Following"
                              : "Follow creator"
                        }
                        pressed={profile.viewerFollowing}
                        secondary={profile.viewerFollowing}
                        disabled={busy}
                        onPress={() => void follow()}
                        icon={profile.viewerFollowing ? "checkmark" : "add"}
                      />
                      {profile.openToCollab && (
                        <Button
                          title="Suggest a collaboration"
                          secondary
                          onPress={() => onRequest(profile)}
                        />
                      )}
                    </View>
                  )}
                </View>
              </View>
              {own && !user?.isDemo && (
                <ReviewNotice content={profile} subject="profile" />
              )}
              {own && profile.visibility === "private" && (
                <View style={x.soft}>
                  <Text style={x.label}>A home before an audience</Text>
                  <Text style={x.small}>
                    Your profile and work are visible only to you. Edit your
                    profile and make it public whenever you want to become
                    discoverable.
                  </Text>
                </View>
              )}
              {own && user?.isDemo && (
                <View style={x.soft}>
                  <Text style={x.small}>
                    Your demo profile and work stay within this session. Create
                    an account to keep them as private drafts, then choose what
                    to publish.
                  </Text>
                  <Button
                    title="Save with an account"
                    secondary
                    small
                    onPress={onAccount}
                  />
                </View>
              )}
              <ErrorNotice message={error} />
              <View style={v.workHeader}>
                <View
                  accessibilityRole="tablist"
                  style={[x.tabRow, { flex: 1 }]}
                >
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: workTab === "published" }}
                    aria-selected={workTab === "published"}
                    onPress={() => setWorkTab("published")}
                    style={[
                      x.textTab,
                      workTab === "published" && x.textTabActive,
                    ]}
                  >
                    <Text
                      style={[
                        v.workTab,
                        { color: workTab === "published" ? C.ink : C.muted },
                      ]}
                    >
                      Work
                    </Text>
                  </Pressable>
                  {own && (
                    <Pressable
                      accessibilityRole="tab"
                      accessibilityState={{ selected: workTab === "drafts" }}
                      aria-selected={workTab === "drafts"}
                      onPress={() => setWorkTab("drafts")}
                      style={[
                        x.textTab,
                        workTab === "drafts" && x.textTabActive,
                      ]}
                    >
                      <Text
                        style={[
                          v.workTab,
                          { color: workTab === "drafts" ? C.ink : C.muted },
                        ]}
                      >
                        Drafts (
                        {posts.filter((p) => p.visibility === "private").length}
                        )
                      </Text>
                    </Pressable>
                  )}
                </View>
                {own && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={onCreate}
                    style={[x.row, { minHeight: 44 }]}
                  >
                    <Icon name="add" color={C.blue} />
                    <Text style={x.link}>Add work</Text>
                  </Pressable>
                )}
              </View>
              <WorkGrid
                posts={visible}
                wide={wide}
                onOpen={onPost}
                onProfile={onProfile}
                onSave={onSave}
              />
              {!visible.length && (
                <Empty
                  title={
                    own
                      ? workTab === "drafts"
                        ? "Room to work things out"
                        : "Your story starts with one project"
                      : "A story still taking shape"
                  }
                  text={
                    own
                      ? "Share a look, a making note, or a work in progress. Start privately if you prefer."
                      : "This creator hasn’t shared any public work yet."
                  }
                  action={own ? "Add your first project" : undefined}
                  onPress={onCreate}
                />
              )}
              {!own && !profile.isExample && (
                <View style={x.wrap}>
                  <Button
                    title="Report profile"
                    secondary
                    small
                    onPress={() => onReport(profile)}
                  />
                  <Button
                    title="Block creator"
                    secondary
                    small
                    onPress={() => onBlock(profile)}
                  />
                </View>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const profileStyles = (C: Palette) =>
  StyleSheet.create({
    hero: { gap: 0 },
    cover: {
      width: "100%",
      borderRadius: 24,
      overflow: "hidden",
      backgroundColor: C.profile,
    },
    emptyCover: {
      alignItems: "flex-end",
      justifyContent: "center",
      padding: 26,
      gap: 10,
    },
    coverCircle: {
      position: "absolute",
      width: 210,
      height: 210,
      left: -45,
      top: -45,
      borderRadius: 110,
      borderWidth: 35,
      borderColor: C.pale,
    },
    coverTitle: {
      color: C.blue,
      fontSize: 18,
      fontWeight: "800",
      letterSpacing: -0.4,
    },
    coverLabel: {
      position: "absolute",
      top: 14,
      right: 14,
      left: 14,
      alignSelf: "flex-end",
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      padding: 9,
      borderRadius: 12,
      backgroundColor: "rgba(0,0,0,0.62)",
    },
    coverLabelText: {
      color: "#FFFFFF",
      fontSize: 11,
      fontWeight: "600",
      flexShrink: 1,
    },
    profileBody: { paddingHorizontal: 4, gap: 18 },
    identityTop: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: 12,
      marginTop: -34,
    },
    avatarRing: {
      borderWidth: 6,
      borderColor: C.bg,
      borderRadius: 56,
      backgroundColor: C.bg,
    },
    profileStatus: { paddingBottom: 9, flexShrink: 1 },
    name: {
      fontSize: 32,
      lineHeight: 38,
      fontWeight: "800",
      letterSpacing: -1,
      color: C.ink,
    },
    handle: { color: C.blue, fontSize: 16, fontWeight: "600" },
    bio: { fontSize: 16, lineHeight: 25, color: C.body },
    stats: {
      flexDirection: "row",
      alignItems: "center",
      gap: 25,
      paddingVertical: 4,
    },
    stat: { gap: 3 },
    statValue: {
      fontSize: 25,
      lineHeight: 31,
      fontWeight: "800",
      color: C.ink,
      letterSpacing: -0.6,
    },
    statLabel: { color: C.muted, fontSize: 12 },
    statDivider: { width: 1, height: 29, backgroundColor: C.line },
    fandom: {
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 20,
      backgroundColor: C.pale,
      maxWidth: "100%",
    },
    fandomText: { fontSize: 11, fontWeight: "700", color: C.blue },
    workHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 12,
    },
    workTab: {
      fontSize: 14,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
  });

const commaList = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
export function EditProfile({
  profile,
  user,
  onClose,
  onSaved,
}: {
  profile: CreatorProfile;
  user: User;
  onClose: () => void;
  onSaved: (profile: CreatorProfile) => void;
}) {
  const { C } = useUI();
  const x = useSocialStyles();
  const moderation = useModerationPolicy();
  const [name, setName] = useState(profile.displayName),
    [handle, setHandle] = useState(profile.handle),
    [bio, setBio] = useState(profile.bio),
    [roles, setRoles] = useState(profile.roles.join(", ")),
    [fandoms, setFandoms] = useState(profile.fandoms.join(", "));
  const [city, setCity] = useState(profile.city),
    [website, setWebsite] = useState(profile.websiteUrl),
    [instagram, setInstagram] = useState(profile.instagramUrl),
    [visibility, setVisibility] = useState<SocialVisibility>(
      profile.visibility,
    ),
    [open, setOpen] = useState(profile.openToCollab),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await socialApi.updateMe({
        displayName: name,
        handle: handle.toLowerCase().trim(),
        bio,
        roles: commaList(roles),
        fandoms: commaList(fandoms),
        city,
        websiteUrl: website.trim(),
        instagramUrl: instagram.trim(),
        visibility,
        openToCollab: open,
      });
      onSaved(updated);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Sheet title="The person behind the work" onClose={onClose} busy={busy}>
      {profile.visibility === "private" && !user.isDemo && (
        <View style={x.soft}>
          <Text style={x.label}>Choose how you want to connect</Text>
          <Text style={x.small}>
            Following, commenting, and collaboration requests use your public
            creator identity. To connect, turn on “Make my profile public”
            below and save. Once your profile is approved, you can
            connect with other creators. You can keep your profile private and
            still browse, save inspiration, and work on drafts.
          </Text>
        </View>
      )}
      {!user.isDemo && <ReviewNotice content={profile} subject="profile" />}
      <Text style={x.body}>
        Use your cosplay identity. Your account email and private crew plans are
        never part of your public profile.
      </Text>
      <ErrorNotice message={error} />
      <Field
        label="Display name"
        value={name}
        onChange={setName}
        placeholder="Your creative name"
      />
      <Field
        label="Handle (3–30 letters, numbers, underscores)"
        value={handle}
        onChange={setHandle}
        placeholder="your_cosplay_name"
      />
      <Field
        label="A little about you"
        value={bio}
        onChange={setBio}
        multiline
        placeholder="What you make, what you love, and what you’d like to try."
      />
      <Field
        label="Creative roles (comma separated)"
        value={roles}
        onChange={setRoles}
        placeholder="Cosplayer, photographer, prop maker"
      />
      <Field
        label="Fandoms & interests (comma separated)"
        value={fandoms}
        onChange={setFandoms}
        placeholder="Original characters, fantasy, anime"
      />
      <Field
        label="City or broad area (optional)"
        value={city}
        onChange={setCity}
        placeholder="No exact address"
      />
      <Field
        label="Website or shop (HTTPS, optional)"
        value={website}
        onChange={setWebsite}
        placeholder="https://"
      />
      <Field
        label="Instagram URL (HTTPS, optional)"
        value={instagram}
        onChange={setInstagram}
        placeholder="https://www.instagram.com/your_handle"
      />
      <View style={x.card}>
        <View style={x.toolbar}>
          <View style={x.grow}>
            <Text style={x.label}>
              {user.isDemo
                ? "Preview a public profile"
                : "Make my profile public"}
            </Text>
            <Text style={x.small}>
              {user.isDemo
                ? "Preview only: your demo stays visible to you."
                : moderation.automatic
                  ? "Anyone can browse your profile and published work once safety checks pass."
                  : "Anyone can browse your profile and published work once approved."}
            </Text>
          </View>
          <Switch
            accessibilityLabel={
              user.isDemo
                ? "Preview a public profile"
                : "Make my profile public"
            }
            value={visibility === "public"}
            onValueChange={(value) =>
              setVisibility(value ? "public" : "private")
            }
            trackColor={{ false: C.borderStrong, true: C.accent }}
            thumbColor={C.onAccent}
            ios_backgroundColor={C.subdued}
          />
        </View>
        <Text style={x.small}>
          {user.isDemo
            ? "Your profile stays inside your private demo."
            : `Your display name, bio, roles, interests, broad city, and links become visible once approved. ${moderation.sharingSummary} Public edits are checked again. A profile held for review also hides your public work and comments. Making your profile private hides previously published work too.`}
        </Text>
        <View style={x.divider} />
        <View style={x.toolbar}>
          <View style={x.grow}>
            <Text style={x.label}>Open to collaboration requests</Text>
            <Text style={x.small}>People can send a thoughtful proposal.</Text>
          </View>
          <Switch
            accessibilityLabel="Open to collaboration requests"
            value={open}
            onValueChange={setOpen}
            trackColor={{ false: C.borderStrong, true: C.accent }}
            thumbColor={C.onAccent}
            ios_backgroundColor={C.subdued}
          />
        </View>
      </View>
      <Button
        title={
          busy
            ? visibility === "public" && !user.isDemo
              ? "Submitting…"
              : "Saving…"
            : visibility === "public" && !user.isDemo
              ? "Save public profile"
              : "Save profile"
        }
        disabled={busy}
        onPress={() => void save()}
      />
    </Sheet>
  );
}
