import React, { useRef, useState } from "react";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { mediaSource, socialApi } from "../api";
import type { User } from "../types";
import { Button, Field, Icon, IconButton, useUI } from "../ui";
import type {
  CreativePost,
  CreativeStage,
  Credit,
  MediaAsset,
  SocialVisibility,
} from "./types";
import {
  Choice,
  ErrorNotice,
  ReviewNotice,
  Sheet,
  Spinner,
  messageOf,
  useResource,
} from "./shared";
import { useSocialStyles } from "./styles";
import VideoPlayer from "./VideoPlayer";
import { validateVideoSelection } from "./videoSelection";
import { useModerationPolicy } from "./moderationPolicy";

type PendingVideo = ImagePicker.ImagePickerAsset & { fileSize: number };

export default function Composer({
  user,
  post,
  onClose,
  onSaved,
}: {
  user: User;
  post?: CreativePost;
  onClose: () => void;
  onSaved: (post: CreativePost) => void;
}) {
  const { C } = useUI();
  const x = useSocialStyles();
  const moderation = useModerationPolicy();
  const profile = useResource(() => socialApi.getMe(), [user.id]);
  const [title, setTitle] = useState(post?.title || ""),
    [character, setCharacter] = useState(post?.character || ""),
    [fandom, setFandom] = useState(post?.fandom || "");
  const [body, setBody] = useState(post?.body || ""),
    [stage, setStage] = useState<CreativeStage>(post?.stage || "wip"),
    [visibility, setVisibility] = useState<SocialVisibility>(
      post?.visibility || "private",
    );
  const [media, setMedia] = useState<MediaAsset[]>(post?.media || []),
    [credits, setCredits] = useState<Credit[]>(post?.credits || []);
  const [openRole, setOpenRole] = useState(!!post?.opportunity),
    [role, setRole] = useState(post?.opportunity?.role || ""),
    [city, setCity] = useState(post?.opportunity?.city || ""),
    [eventName, setEventName] = useState(post?.opportunity?.eventName || ""),
    [date, setDate] = useState(post?.opportunity?.date || "");
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [pendingVideo, setPendingVideo] = useState<PendingVideo | null>(null);
  const [permissionHelp, setPermissionHelp] = useState(false);
  const [activeMediaId, setActiveMediaId] = useState(post?.media[0]?.id || "");
  const activeMedia =
    media.find((asset) => asset.id === activeMediaId) || media[0];
  const activeMediaIndex = activeMedia ? media.indexOf(activeMedia) : 0;
  const hasVideo =
    !!pendingVideo || media.some((asset) => asset.kind === "video");
  const automaticSharing = hasVideo ? moderation.automaticVideo : moderation.automatic;
  const lock = useRef(false);
  const pick = async () => {
    if (lock.current || media.length >= 4 || hasVideo) return;
    lock.current = true;
    setError("");
    setPermissionHelp(false);
    setUploadMessage("Preparing your photos…");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 4 - media.length,
        quality: 1,
      });
      if (result.canceled) return;
      setUploading(true);
      for (const asset of result.assets.slice(0, 4 - media.length)) {
        const resize =
          asset.width > asset.height
            ? { width: Math.min(asset.width, 1600) }
            : { height: Math.min(asset.height, 1600) };
        const processed = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize }],
          {
            compress: 0.85,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
          },
        );
        if (!processed.base64)
          throw new Error(
            "That image could not be prepared. Please choose another photo.",
          );
        const uploaded = await socialApi.uploadMedia(
          processed.base64,
          "image/jpeg",
        );
        setMedia((previous) => [...previous, { ...uploaded, alt: "" }]);
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setUploading(false);
    }
  };
  const uploadSelectedVideo = async (asset: PendingVideo) => {
    setUploadMessage("Uploading and preparing your video… Keep Crewroom open.");
    const uploaded = await socialApi.uploadVideo(asset.uri, asset.mimeType);
    setMedia([{ ...uploaded, alt: "" }]);
    setActiveMediaId(uploaded.id);
    setPendingVideo(null);
  };
  const retryVideoUpload = async () => {
    if (!pendingVideo || lock.current) return;
    lock.current = true;
    setUploading(true);
    setError("");
    try {
      await uploadSelectedVideo(pendingVideo);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setUploading(false);
      setUploadMessage("");
    }
  };
  const pickVideo = async (record: boolean) => {
    if (Platform.OS === "web" || lock.current || media.length || pendingVideo)
      return;
    lock.current = true;
    setUploading(true);
    setUploadMessage("Getting ready…");
    setError("");
    setPermissionHelp(false);
    try {
      const config = await socialApi.getVideoConfig();
      if (!config.enabled) {
        throw new Error(
          "Video is not available on this server yet. Please try again after the beta update.",
        );
      }
      if (record) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setPermissionHelp(true);
          throw new Error(
            "Allow camera access in Settings to record your cosplay. You can also choose a video from your library.",
          );
        }
      } else if (Platform.OS === "ios") {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setPermissionHelp(true);
          throw new Error(
            "Allow photo library access in Settings to choose a video. Limited access to selected items is enough.",
          );
        }
      }
      setUploadMessage(
        record ? "Opening your camera…" : "Opening your library…",
      );
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["videos"],
        allowsMultipleSelection: false,
        allowsEditing: false,
        videoMaxDuration: Math.min(60, config.maxDuration),
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      };
      const result = record
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error("Choose a video to continue.");
      let fileSize = asset.fileSize;
      if (!fileSize) {
        const { File } = await import("expo-file-system");
        fileSize = new File(asset.uri).size;
      }
      validateVideoSelection({ ...asset, fileSize }, config);
      const selected = { ...asset, fileSize };
      // Keep the picker URI until a confirmed upload succeeds, so a network
      // failure never makes the creator record or select the same clip again.
      setPendingVideo(selected);
      await uploadSelectedVideo(selected);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setUploading(false);
      setUploadMessage("");
    }
  };
  const save = async () => {
    if (lock.current) return;
    setError("");
    if (pendingVideo) {
      setError(
        "Retry your video upload or discard the selected video before saving this post.",
      );
      return;
    }
    if (!title.trim()) {
      setError("Give your work a title.");
      return;
    }
    if (visibility === "public" && !media.length) {
      setError(
        Platform.OS === "web"
          ? "Add at least one photo before submitting your work."
          : "Add photos or a video before submitting your work.",
      );
      return;
    }
    if (
      visibility === "public" &&
      profile.data?.visibility !== "public" &&
      !consent
    ) {
      setError(
        "Choose to make your creator profile public, or save a private draft.",
      );
      return;
    }
    if (openRole && !role.trim()) {
      setError("Tell people which creative role you are looking for.");
      return;
    }
    if (credits.some((c) => !c.name.trim() || !c.role.trim())) {
      setError(
        "Add a name and role for each credit, or remove the empty credit.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const input = {
        title: title.trim(),
        character,
        fandom,
        body,
        stage,
        visibility,
        mediaIds: media.map((m) => m.id),
        mediaAlts: media.map((m) => m.alt),
        credits,
        opportunity: openRole ? { role, city, eventName, date } : null,
        publishProfile: visibility === "public" && consent,
      };
      const saved = post
        ? await socialApi.updatePost(post.id, input)
        : await socialApi.createPost(input);
      onSaved(saved);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={post ? "Edit your work" : "Create a post"}
      onClose={onClose}
      busy={busy || uploading}
    >
      <View style={{ gap: 9 }}>
        <Text style={x.eyebrow}>FROM YOUR WORKBENCH TO YOUR WORLD</Text>
        <Text style={[x.sectionTitle, { fontSize: 28 }]}>
          Show what you’re making.
        </Text>
        <Text style={x.body}>
          The finished look. The work in progress. The details only you would
          notice.
        </Text>
      </View>
      {user.isDemo && (
        <View style={x.soft}>
          <Text style={x.label}>Try it in your private demo</Text>
          <Text style={x.small}>
            Only you can see this demo work. Creating a real account keeps your
            work as private drafts so you can choose what to publish.
          </Text>
        </View>
      )}
      {post && !user.isDemo && <ReviewNotice content={post} subject="work" />}
      <ErrorNotice message={error} />
      {permissionHelp && (
        <Button
          title="Open device Settings"
          secondary
          icon="settings-outline"
          onPress={() => {
            void Linking.openSettings().catch(() =>
              setError(
                "Open your phone’s Settings and choose Crewroom to update permissions.",
              ),
            );
          }}
        />
      )}
      <View style={{ gap: 14 }}>
        <View style={x.toolbar}>
          <Text style={x.label}>{hasVideo ? "YOUR VIDEO" : "YOUR PHOTOS"}</Text>
          <Text style={x.small}>
            {hasVideo ? "1 video" : `${media.length} / 4`}
          </Text>
        </View>
        {pendingVideo && (
          <View style={[x.card, { padding: 16, gap: 14, borderRadius: 24 }]}>
            <View style={{ borderRadius: 18, overflow: "hidden" }}>
              <VideoPlayer
                media={{
                  id: "pending-video",
                  kind: "video",
                  url: pendingVideo.uri,
                  width: pendingVideo.width,
                  height: pendingVideo.height,
                  duration: (pendingVideo.duration || 0) / 1000,
                  alt: "Selected video waiting to upload",
                }}
                active={false}
                controls
                muted={false}
                style={{ width: "100%", aspectRatio: 0.8 }}
              />
            </View>
            <Text style={x.label}>
              {uploading ? "Uploading your video" : "Video not uploaded yet"}
            </Text>
            {uploading ? (
              <View style={{ gap: 10 }}>
                <Spinner />
                <Text style={x.small}>{uploadMessage}</Text>
              </View>
            ) : (
              <Text style={x.small}>
                Your clip is still selected. Retry the upload without recording
                again, or discard it to choose something else. Keep this screen
                open to retain the selection.
              </Text>
            )}
            <Button
              title="Retry upload"
              icon="cloud-upload-outline"
              disabled={busy || uploading}
              onPress={() => void retryVideoUpload()}
            />
            <Button
              title="Discard video"
              secondary
              icon="trash-outline"
              disabled={busy || uploading}
              onPress={() => {
                if (lock.current) return;
                setPendingVideo(null);
                setError("");
              }}
            />
          </View>
        )}
        {activeMedia && (
          <>
            <View
              style={{
                borderRadius: 24,
                overflow: "hidden",
                backgroundColor: C.image,
              }}
            >
              {activeMedia.kind === "video" ? (
                <VideoPlayer
                  media={activeMedia}
                  active={false}
                  controls
                  muted={false}
                  style={{ width: "100%", aspectRatio: 0.8 }}
                />
              ) : (
                <Image
                  source={mediaSource(activeMedia)}
                  accessibilityLabel={
                    activeMedia.alt || `Selected image ${activeMediaIndex + 1}`
                  }
                  style={[
                    x.image,
                    {
                      aspectRatio: Math.max(
                        0.9,
                        Math.min(
                          activeMedia.width / Math.max(activeMedia.height, 1),
                          1.5,
                        ),
                      ),
                    },
                  ]}
                  resizeMode="contain"
                />
              )}
              <View
                style={{
                  position: "absolute",
                  top: 12,
                  left: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  backgroundColor: C.imageBadge,
                  borderRadius: 20,
                }}
              >
                <Text style={x.label}>
                  {activeMedia.kind === "video"
                    ? `Video${activeMedia.duration ? ` · ${Math.ceil(activeMedia.duration)}s` : ""}`
                    : activeMediaIndex === 0
                      ? "Cover photo"
                      : `Photo ${activeMediaIndex + 1}`}
                </Text>
              </View>
              <View
                style={{
                  position: "absolute",
                  right: 10,
                  top: 10,
                  backgroundColor: C.imageBadge,
                  borderRadius: 24,
                }}
              >
                <IconButton
                  name="close"
                  label={
                    activeMedia.kind === "video"
                      ? "Remove video"
                      : `Remove image ${activeMediaIndex + 1}`
                  }
                  onPress={() => {
                    if (!busy && !uploading)
                      setMedia((list) =>
                        list.filter((asset) => asset.id !== activeMedia.id),
                      );
                  }}
                />
              </View>
            </View>
            {!hasVideo && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10 }}
              >
                {media.map((asset, index) => (
                  <Pressable
                    key={asset.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit image ${index + 1}${index === 0 ? ", cover photo" : ""}`}
                    accessibilityState={{
                      selected: activeMedia.id === asset.id,
                    }}
                    onPress={() => setActiveMediaId(asset.id)}
                    style={{
                      padding: 3,
                      borderRadius: 17,
                      borderWidth: 2,
                      borderColor:
                        activeMedia.id === asset.id ? C.blue : C.line,
                    }}
                  >
                    <Image
                      source={mediaSource(asset)}
                      style={{
                        width: 64,
                        height: 78,
                        borderRadius: 12,
                        backgroundColor: C.image,
                      }}
                      resizeMode="cover"
                    />
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Field
              label={
                hasVideo
                  ? "Video description"
                  : `Image ${activeMediaIndex + 1} description`
              }
              value={activeMedia.alt}
              onChange={(value) =>
                setMedia((list) =>
                  list.map((asset) =>
                    asset.id === activeMedia.id
                      ? { ...asset, alt: value }
                      : asset,
                  ),
                )
              }
              placeholder={
                hasVideo
                  ? "Describe the action and any important speech or sound"
                  : "Describe this photo for someone who can’t see it"
              }
            />
          </>
        )}
        {media.length < 4 && !hasVideo && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose photos from library"
            accessibilityState={{ disabled: busy || uploading }}
            disabled={busy || uploading}
            onPress={() => void pick()}
            style={({ pressed }) => [
              x.upload,
              {
                minHeight: media.length ? 94 : 280,
                borderRadius: 26,
                borderStyle: "solid",
                gap: 15,
                opacity: busy ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            {uploading ? (
              <>
                <Spinner />
                <Text style={[x.small, { textAlign: "center" }]}>
                  {uploadMessage}
                </Text>
              </>
            ) : (
              <>
                {!media.length && (
                  <View
                    style={{
                      width: 92,
                      height: 106,
                      borderRadius: 23,
                      backgroundColor: C.white,
                      borderWidth: 1,
                      borderColor: C.selectionBorder,
                      alignItems: "center",
                      justifyContent: "center",
                      transform: [{ rotate: "-7deg" }],
                    }}
                  >
                    <Icon name="images-outline" color={C.blue} size={43} />
                    <View
                      style={{
                        position: "absolute",
                        bottom: -9,
                        right: -9,
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        backgroundColor: C.accent,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name="add" color={C.onAccent} size={22} />
                    </View>
                  </View>
                )}
                <View style={{ gap: 6, alignItems: "center" }}>
                  <View style={x.row}>
                    {!!media.length && (
                      <Icon
                        name="add-circle-outline"
                        color={C.blue}
                        size={22}
                      />
                    )}
                    <Text
                      style={[x.label, { fontSize: media.length ? 14 : 20 }]}
                    >
                      {media.length
                        ? "Add more photos"
                        : "Start with your photos"}
                    </Text>
                  </View>
                  <Text style={[x.small, { textAlign: "center" }]}>
                    Choose from your library · up to 4 images
                  </Text>
                </View>
              </>
            )}
          </Pressable>
        )}
        {Platform.OS !== "web" && media.length === 0 && !pendingVideo && (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <View style={{ flex: 1, minWidth: 155 }}>
                <Button
                  title="Record video"
                  icon="videocam-outline"
                  disabled={busy || uploading}
                  onPress={() => void pickVideo(true)}
                />
              </View>
              <View style={{ flex: 1, minWidth: 155 }}>
                <Button
                  title="Choose video"
                  secondary
                  icon="film-outline"
                  disabled={busy || uploading}
                  onPress={() => void pickVideo(false)}
                />
              </View>
            </View>
            <Text style={[x.small, { textAlign: "center" }]}>
              One video up to 60 seconds and 50 MB, or up to 4 photos. Your
              camera will ask for permission to record sound.
            </Text>
          </View>
        )}
        {hasVideo && !pendingVideo && (
          <Text style={x.small}>
            Play your video to check it before sharing. To use photos instead,
            remove this video first.
          </Text>
        )}
        {!!media.length && !hasVideo && (
          <Text style={x.small}>
            Your first image is the cover. Location metadata is removed before
            sharing.
            {Platform.OS !== "web"
              ? " To add a video, remove these photos first."
              : ""}
          </Text>
        )}
      </View>
      <View style={{ gap: 12 }}>
        <Text style={x.label}>WHAT ARE YOU SHARING?</Text>
        <View style={x.wrap}>
          {(["wip", "finished", "tutorial"] as const).map((value) => (
            <Choice
              key={value}
              label={
                value === "wip"
                  ? "In progress"
                  : value === "finished"
                    ? "Finished look"
                    : "Tutorial"
              }
              active={stage === value}
              onPress={() => setStage(value)}
            />
          ))}
        </View>
      </View>
      <View style={[x.card, { padding: 18, borderRadius: 24, gap: 18 }]}>
        <View style={x.row}>
          <Icon name="create-outline" color={C.blue} />
          <Text style={x.sectionTitle}>The story</Text>
        </View>
        <Field
          label="Title"
          value={title}
          onChange={setTitle}
          placeholder="The cloudkeeper, finally ready"
        />
        <Field
          label="Character or original creation"
          value={character}
          onChange={setCharacter}
          placeholder="Who are you bringing to life?"
        />
        <Field
          label="Fandom or theme"
          value={fandom}
          onChange={setFandom}
          placeholder="A favorite series, original characters…"
        />
        <Field
          label="The story & making notes"
          value={body}
          onChange={setBody}
          multiline
          placeholder="The idea, the tricky part, something you learned. Give the work a little context."
        />
      </View>
      <View style={[x.card, { padding: 18, borderRadius: 24, gap: 15 }]}>
        <View style={x.row}>
          <Icon name="people-outline" color={C.blue} />
          <Text style={x.sectionTitle}>Made with</Text>
        </View>
        <Text style={x.small}>
          Credit the people who helped. These are your attributions, not
          verified endorsements.
        </Text>
        {credits.map((credit, index) => (
          <View style={x.card} key={index}>
            <Field
              label={`Credit ${index + 1}: name`}
              value={credit.name}
              onChange={(value) =>
                setCredits((list) =>
                  list.map((c, i) => (i === index ? { ...c, name: value } : c)),
                )
              }
              placeholder="Creator’s name"
            />
            <Field
              label={`Credit ${index + 1}: role`}
              value={credit.role}
              onChange={(value) =>
                setCredits((list) =>
                  list.map((c, i) => (i === index ? { ...c, role: value } : c)),
                )
              }
              placeholder="Photography, costume, styling…"
            />
            <Button
              title="Remove credit"
              secondary
              small
              onPress={() =>
                setCredits((list) => list.filter((_, i) => i !== index))
              }
            />
          </View>
        ))}
        <Button
          title="Add a collaborator credit"
          secondary
          icon="person-add-outline"
          onPress={() =>
            setCredits((list) => [...list, { name: "", role: "" }])
          }
        />
      </View>
      <View style={[x.card, { padding: 18, borderRadius: 24 }]}>
        <View style={x.toolbar}>
          <View style={x.grow}>
            <Text style={[x.label, { fontSize: 16 }]}>
              Open to collaboration
            </Text>
            <Text style={x.small}>Let people request a collaboration.</Text>
          </View>
          <Switch
            accessibilityLabel="Open a collaboration opportunity"
            value={openRole}
            onValueChange={setOpenRole}
            trackColor={{ false: C.borderStrong, true: C.accent }}
            thumbColor={C.onAccent}
            ios_backgroundColor={C.subdued}
          />
        </View>
        {openRole && (
          <>
            <Field
              label="Creative role you’re looking for"
              value={role}
              onChange={setRole}
              placeholder="Photographer, prop maker, fellow cosplayer…"
            />
            <Field
              label="City or broad area (optional)"
              value={city}
              onChange={setCity}
              placeholder="Brooklyn, NY — no exact address"
            />
            <Field
              label="Event or shoot (optional)"
              value={eventName}
              onChange={setEventName}
              placeholder="A fall portrait session"
            />
            <Field
              label="Date (YYYY-MM-DD, optional)"
              value={date}
              onChange={setDate}
              placeholder="2026-10-24"
            />
            <Text style={x.small}>
              Keep exact meeting spots in private plans. Accepting a request
              creates a new private crew; it never admits someone to an existing
              one.
            </Text>
          </>
        )}
      </View>
      <View style={{ gap: 12 }}>
        <View style={x.row}>
          <Icon name="eye-outline" color={C.blue} />
          <Text style={x.sectionTitle}>Who can see this?</Text>
        </View>
        {(["private", "public"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: visibility === value }}
            aria-checked={visibility === value}
            onPress={() => setVisibility(value)}
            style={[x.choice, visibility === value && x.choiceActive]}
          >
            <Icon
              name={
                value === "private" ? "lock-closed-outline" : "globe-outline"
              }
              color={C.blue}
            />
            <View style={x.grow}>
              <Text style={x.label}>
                {value === "private"
                  ? "Private draft"
                  : user.isDemo
                    ? "Preview a public post"
                    : "Public post"}
              </Text>
              <Text style={x.small}>
                {value === "private"
                  ? "Only you. Take your time."
                  : user.isDemo
                    ? "Still visible only inside your private demo."
                    : automaticSharing
                      ? "Anyone can view it once your post and profile pass safety checks."
                      : "Anyone can view it once your post and profile are approved."}
              </Text>
            </View>
            <Icon
              name={
                visibility === value ? "radio-button-on" : "radio-button-off"
              }
              color={C.blue}
            />
          </Pressable>
        ))}
      </View>
      {visibility === "public" && !user.isDemo && (
        <View style={x.soft}>
          <Text style={x.label}>Checked before sharing</Text>
          <Text style={x.small}>
            {hasVideo ? moderation.videoSharingSummary : moderation.sharingSummary} Public edits are checked again before
            they appear to others.
          </Text>
        </View>
      )}
      {visibility === "public" && !user.isDemo && profile.data && (
        <ReviewNotice content={profile.data} subject="profile" />
      )}
      {visibility === "public" && profile.data?.visibility !== "public" && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consent }}
          aria-checked={consent}
          onPress={() => setConsent((v) => !v)}
          style={[x.choice, consent && x.choiceActive]}
        >
          <Icon name={consent ? "checkbox" : "square-outline"} color={C.blue} />
          <Text style={[x.body, { flex: 1 }]}>
            {user.isDemo
              ? "Preview my creator profile as public within this demo."
              : "Make my creator profile public too. Once approved, my display name, bio, roles, links, and broad city will be visible. Private crew plans stay private."}
          </Text>
        </Pressable>
      )}
      <ErrorNotice
        message={profile.error}
        retry={() => void profile.reload()}
      />
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: C.line,
          paddingTop: 18,
          gap: 10,
        }}
      >
        <Text style={[x.small, { textAlign: "center" }]}>
          {pendingVideo
            ? "Finish uploading or discard your selected video before saving."
            : visibility === "private"
              ? "Save it for yourself. Share when you’re ready."
              : user.isDemo
                ? "This preview stays inside your private demo."
                : automaticSharing
                  ? "Your post publishes when its safety checks and profile checks pass."
                  : "Your post stays visible only to you until approved."}
        </Text>
        <Button
          title={
            busy
              ? visibility === "public" && !user.isDemo
                ? "Submitting…"
                : "Saving…"
              : visibility === "private"
                ? "Save private draft"
                : user.isDemo
                  ? "Save demo preview"
                  : post
                    ? "Publish changes"
                    : "Publish post"
          }
          disabled={
            busy ||
            uploading ||
            !!pendingVideo ||
            profile.loading ||
            !!profile.error
          }
          onPress={() => void save()}
          icon={
            visibility === "private"
              ? "lock-closed-outline"
              : "arrow-up-outline"
          }
        />
      </View>
    </Sheet>
  );
}
