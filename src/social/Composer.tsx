import React, { useRef, useState } from "react";
import { Image, Pressable, Switch, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { mediaSource, socialApi } from "../api";
import type { User } from "../types";
import { Button, Field, Icon, IconButton, Tag, useUI } from "../ui";
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
  Sheet,
  Spinner,
  messageOf,
  useResource,
} from "./shared";
import { useSocialStyles } from "./styles";

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
  const { C, s } = useUI();
  const x = useSocialStyles();
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
  const lock = useRef(false);
  const pick = async () => {
    if (lock.current || media.length >= 4) return;
    lock.current = true;
    setError("");
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
  const save = async () => {
    if (lock.current) return;
    setError("");
    if (!title.trim()) {
      setError("Give your work a title.");
      return;
    }
    if (visibility === "public" && !media.length) {
      setError("Add at least one image before publishing.");
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
      title={post ? "Edit your work" : "Something worth sharing"}
      onClose={onClose}
      busy={busy || uploading}
    >
      <View style={{ gap: 6 }}>
        <Text style={x.eyebrow}>YOUR WORK, ON YOUR TERMS</Text>
        <Text style={x.body}>
          A finished look, a small breakthrough, or how you made it. You don’t
          need a crew to start.
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
      <ErrorNotice message={error} />
      <View style={{ gap: 15 }}>
        {media.map((asset, index) => (
          <View key={asset.id} style={x.card}>
            <View>
              <Image
                source={mediaSource(asset)}
                accessibilityLabel={asset.alt || `Selected image ${index + 1}`}
                style={[x.image, { aspectRatio: 1.5, borderRadius: 13 }]}
                resizeMode="cover"
              />
              <View
                style={{
                  position: "absolute",
                  right: 8,
                  top: 8,
                  backgroundColor: C.white,
                  borderRadius: 12,
                }}
              >
                <IconButton
                  name="close"
                  label={`Remove image ${index + 1}`}
                  onPress={() => {
                    if (!busy && !uploading)
                      setMedia((list) => list.filter((m) => m.id !== asset.id));
                  }}
                />
              </View>
            </View>
            <Field
              label={`Image ${index + 1} description`}
              value={asset.alt}
              onChange={(value) =>
                setMedia((list) =>
                  list.map((m) =>
                    m.id === asset.id ? { ...m, alt: value } : m,
                  ),
                )
              }
              placeholder="Describe the image for someone who can’t see it"
            />
          </View>
        ))}
        {media.length < 4 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose photos from library"
            disabled={busy || uploading}
            onPress={() => void pick()}
            style={x.upload}
          >
            {uploading ? (
              <Spinner />
            ) : (
              <>
                <Icon name="images-outline" color={C.blue} size={30} />
                <Text style={x.label}>
                  {media.length
                    ? "Add another image"
                    : "Let your work do the talking"}
                </Text>
                <Text style={[x.small, { textAlign: "center" }]}>
                  Choose photos · up to 4 images
                </Text>
              </>
            )}
          </Pressable>
        )}
        {!!media.length && (
          <Text style={x.small}>
            Images are prepared for sharing and location metadata is removed.
          </Text>
        )}
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
      <View style={{ gap: 9 }}>
        <Text style={x.label}>Where’s the work at?</Text>
        <View style={x.wrap}>
          {(["wip", "finished", "tutorial"] as const).map((value) => (
            <Choice
              key={value}
              label={
                value === "wip"
                  ? "In progress"
                  : value === "finished"
                    ? "Finished"
                    : "Tutorial"
              }
              active={stage === value}
              onPress={() => setStage(value)}
            />
          ))}
        </View>
      </View>
      <Field
        label="The story & making notes"
        value={body}
        onChange={setBody}
        multiline
        placeholder="The idea, the tricky part, something you learned. Give the work a little context."
      />
      <View style={{ gap: 13 }}>
        <Text style={x.sectionTitle}>Made with</Text>
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
      <View style={x.card}>
        <View style={x.toolbar}>
          <View style={x.grow}>
            <Text style={x.label}>Make something together</Text>
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
      <View style={{ gap: 11 }}>
        <Text style={x.sectionTitle}>Who can see this?</Text>
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
                    : "Publish to your public profile"}
              </Text>
              <Text style={x.small}>
                {value === "private"
                  ? "Only you. Take your time."
                  : user.isDemo
                    ? "Still visible only inside your private demo."
                    : "Visible to anyone, including people without an account."}
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
              : "Make my creator profile public too. My display name, bio, roles, links, and broad city will be visible. Private crew plans stay private."}
          </Text>
        </Pressable>
      )}
      <ErrorNotice
        message={profile.error}
        retry={() => void profile.reload()}
      />
      <Button
        title={
          busy
            ? "Saving…"
            : visibility === "private"
              ? "Save private draft"
              : user.isDemo
                ? "Save demo preview"
                : post
                  ? "Save & publish changes"
                  : "Publish my work"
        }
        disabled={busy || uploading || profile.loading || !!profile.error}
        onPress={() => void save()}
        icon={
          visibility === "private" ? "lock-closed-outline" : "arrow-up-outline"
        }
      />
    </Sheet>
  );
}
