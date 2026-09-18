import React, { useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  Switch,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { getPublicWebUrl, socialApi } from "../api";
import type { User } from "../types";
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
  useResource,
} from "./shared";
import { useSocialStyles } from "./styles";

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
  const { C, s } = useUI();
  const x = useSocialStyles();
  const resource = useResource<ProfileResult | null>(async () => {
    if (handle) return socialApi.getProfile(handle);
    if (!user) return null;
    const me = await socialApi.getMe();
    return socialApi.getProfile(me.handle);
  }, [handle, user?.id, user?.isDemo, revision]);
  const profile = resource.data?.profile,
    posts = resource.data?.posts || [];
  const own = !!user && profile?.userId === user.id;
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
  return (
    <ScrollView
      contentContainerStyle={[x.content, wide && { paddingHorizontal: 30 }]}
      refreshControl={
        <RefreshControl
          refreshing={resource.loading && !!resource.data}
          onRefresh={() => void resource.reload()}
          tintColor={C.blue}
        />
      }
    >
      <View style={x.toolbar}>
        <Text style={x.eyebrow}>
          {own ? "Your creative home" : "Behind the work"}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onCrews}
          style={[x.row, { minHeight: 44 }]}
        >
          <Text style={x.link}>My crews</Text>
          <Icon name="arrow-forward" color={C.blue} size={16} />
        </Pressable>
      </View>
      {!user && !handle ? (
        <AccountPrompt
          title="Make a little space for your work"
          text="Create a profile, keep private drafts, and submit work for public sharing when you’re ready."
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
              <View style={x.profileHero}>
                <View style={x.toolbar}>
                  <Avatar
                    name={profile.displayName}
                    size={72}
                    color={C.white}
                  />
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
                          ? profile.reviewStatus === "rejected"
                            ? "Not approved"
                            : "Awaiting review"
                          : profile.visibility === "public"
                            ? "Public profile"
                            : "Private profile"}
                    </Tag>
                  ) : profile.openToCollab ? (
                    <Tag tone="green">Open to creating</Tag>
                  ) : null}
                </View>
                <View style={{ gap: 6 }}>
                  <Text style={x.title}>{profile.displayName}</Text>
                  <Text style={x.small}>
                    @{profile.handle}
                    {profile.city ? ` · ${profile.city}` : ""}
                  </Text>
                </View>
                <View style={x.wrap}>
                  {profile.roles.map((role) => (
                    <Tag key={role} tone="muted">
                      {role}
                    </Tag>
                  ))}
                </View>
                {profile.bio ? (
                  <Text style={[x.body, { color: C.ink }]}>{profile.bio}</Text>
                ) : own ? (
                  <Text style={x.body}>
                    Tell people about the person behind the work. Your profile
                    starts private.
                  </Text>
                ) : null}
                {!profile.isExample && (
                  <View style={x.row}>
                    <Text style={x.small}>
                      {profile.projectCount}{" "}
                      {profile.projectCount === 1 ? "project" : "projects"}
                    </Text>
                    <Text style={x.small}>·</Text>
                    <Text style={x.small}>
                      {profile.followerCount}{" "}
                      {profile.followerCount === 1 ? "follower" : "followers"}
                    </Text>
                  </View>
                )}
                {profile.fandoms.length > 0 && (
                  <Text style={x.small}>
                    Into {profile.fandoms.join(" · ")}
                  </Text>
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
                      secondary
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
              {own && !user?.isDemo && (
                <ReviewNotice content={profile} subject="profile" />
              )}
              {own && profile.visibility === "private" && (
                <View style={x.soft}>
                  <Text style={x.label}>A home before an audience</Text>
                  <Text style={x.small}>
                    Your profile and work are visible only to you. Edit your
                    profile and submit it for review whenever you want to become
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
              <View style={x.toolbar}>
                <View accessibilityRole="tablist" style={x.tabRow}>
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
                    <Text style={x.label}>Work</Text>
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
                      <Text style={x.label}>
                        Private drafts (
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
  const { C, s } = useUI();
  const x = useSocialStyles();
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
            creator identity. To connect, turn on “Submit my profile for public
            sharing” below and submit it for review. Once approved, you can connect with other
            creators. You can keep your profile private and still browse, save
            inspiration, and work on drafts.
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
              {user.isDemo ? "Preview a public profile" : "Submit my profile for public sharing"}
            </Text>
            <Text style={x.small}>
              {user.isDemo
                ? "Preview only: your demo stays visible to you."
                : "After review, anyone can browse your profile and approved work."}
            </Text>
          </View>
          <Switch
            accessibilityLabel={
              user.isDemo ? "Preview a public profile" : "Submit my profile for public sharing"
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
            : "Your display name, bio, roles, interests, broad city, and links become visible after approval. Editing a public profile sends it back for review and hides your profile, public work, and comments until approved again. Private drafts stay private. Making this profile private hides previously published work too."}
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
            ? visibility === "public" && !user.isDemo ? "Submitting…" : "Saving…"
            : visibility === "public" && !user.isDemo ? "Submit profile for review" : "Save profile"
        }
        disabled={busy}
        onPress={() => void save()}
      />
    </Sheet>
  );
}
