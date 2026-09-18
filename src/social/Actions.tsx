import React, { useRef, useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { socialApi } from "../api";
import { AppearanceControl, Button, Field, useUI } from "../ui";
import type {
  CreativePost,
  CreatorProfile,
  ReportInput,
  ReportReason,
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

export function RequestSheet({
  recipient,
  post,
  onClose,
  onSent,
}: {
  recipient: CreatorProfile;
  post?: CreativePost;
  onClose: () => void;
  onSent: () => void;
}) {
  const x = useSocialStyles();
  const [title, setTitle] = useState(post ? `Let’s make: ${post.title}` : ""),
    [role, setRole] = useState(post?.opportunity?.role || ""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const send = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await socialApi.createRequest({
        recipientId: recipient.userId,
        postId: post?.id,
        title,
        role,
        message,
      });
      onSent();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  return (
    <Sheet
      title={`Create with ${recipient.displayName}`}
      onClose={onClose}
      busy={busy}
    >
      <Text style={x.body}>
        Start with an idea and a thoughtful introduction. They can accept or
        decline.
      </Text>
      <ErrorNotice message={error} />
      <Field
        label="What would you like to make?"
        value={title}
        onChange={setTitle}
        placeholder="An autumn portrait shoot"
      />
      <Field
        label="Your role in this collaboration"
        value={role}
        onChange={setRole}
        placeholder="Photographer, cosplayer, maker…"
      />
      <Field
        label="Introduce your idea"
        value={message}
        onChange={setMessage}
        multiline
        placeholder="Tell them what you have in mind, what you can contribute, and a rough timeframe."
      />
      <View style={x.soft}>
        <Text style={x.small}>
          If accepted, you’ll share a new private crew and plan. Neither person
          gains access to the other’s existing crews. Save exact locations for
          that private space.
        </Text>
      </View>
      <Button
        title={busy ? "Sending…" : "Send collaboration request"}
        disabled={busy}
        onPress={() => void send()}
        icon="paper-plane-outline"
      />
    </Sheet>
  );
}

export function ReportSheet({
  target,
  onClose,
  onReported,
}: {
  target: Pick<ReportInput, "targetId" | "targetType">;
  onClose: () => void;
  onReported: () => void;
}) {
  const x = useSocialStyles();
  const [reason, setReason] = useState<ReportReason>("harassment"),
    [details, setDetails] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const send = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await socialApi.report({ ...target, reason, details });
      onReported();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  return (
    <Sheet title="Report a concern" onClose={onClose} busy={busy}>
      <Text style={x.body}>
        Reports are saved for the pilot’s moderator. A reported post will be
        hidden from your view; a report does not automatically remove anyone
        else’s work.
      </Text>
      <ErrorNotice message={error} />
      <View style={x.wrap}>
        {(["harassment", "stolen-work", "spam", "other"] as const).map(
          (value) => (
            <Choice
              key={value}
              label={
                {
                  harassment: "Harassment",
                  "stolen-work": "Stolen work",
                  spam: "Spam",
                  other: "Other",
                }[value]
              }
              active={reason === value}
              onPress={() => setReason(value)}
            />
          ),
        )}
      </View>
      <Field
        label="What happened? (optional)"
        value={details}
        onChange={setDetails}
        multiline
        placeholder="Include context that will help review this report."
      />
      <Button
        title={busy ? "Sending…" : "Submit report"}
        disabled={busy}
        onPress={() => void send()}
      />
    </Sheet>
  );
}

export function BlockSheet({
  profile,
  onClose,
  onBlocked,
}: {
  profile: CreatorProfile;
  onClose: () => void;
  onBlocked: () => void;
}) {
  const x = useSocialStyles();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const block = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await socialApi.block(profile.userId);
      onBlocked();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Block ${profile.displayName}?`}
      onClose={onClose}
      busy={busy}
    >
      <Text style={x.body}>
        You won’t see one another’s work or contact each other through this
        network while signed in. Pending collaboration requests are cancelled
        and follows are removed.
      </Text>
      <View style={x.soft}>
        <Text style={x.small}>
          Existing private crew memberships are unchanged. Manage those
          separately in My crews. Public work remains visible to people browsing
          without an account.
        </Text>
      </View>
      <ErrorNotice message={error} />
      <Button
        title={busy ? "Blocking…" : "Block this creator"}
        disabled={busy}
        onPress={() => void block()}
      />
      <Button
        title="Keep connection"
        secondary
        disabled={busy}
        onPress={onClose}
      />
    </Sheet>
  );
}

export function SettingsSheet({
  onClose,
  onChanged,
  notify,
  onAccountSettings,
}: {
  onClose: () => void;
  onChanged: () => void;
  notify: (message: string) => void;
  onAccountSettings?: () => void;
}) {
  const x = useSocialStyles();
  const blocked = useResource(() => socialApi.getBlocks(), []);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [exportJson, setExportJson] = useState("");
  const lock = useRef(false);
  const unblock = async (id: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(id);
    setError("");
    try {
      await socialApi.unblock(id);
      await blocked.reload();
      onChanged();
      notify("Creator unblocked.");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  const exportWork = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy("export");
    setError("");
    try {
      const result = await socialApi.exportOwn();
      const json = JSON.stringify(result, null, 2);
      setExportJson(json);
      if (Platform.OS === "web") {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "crewroom-my-work.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify("Your JSON export is ready.");
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  return (
    <Sheet title="Your space, your choices" onClose={onClose} busy={!!busy}>
      <ErrorNotice message={error} />
      <AppearanceControl />
      <View style={x.divider} />
      {onAccountSettings && (
        <Button title="Account & security" secondary icon="shield-checkmark-outline" onPress={onAccountSettings} />
      )}
      <View style={{ gap: 12 }}>
        <Text style={x.sectionTitle}>Keep a copy of your work</Text>
        <Text style={x.body}>
          Export your profile, posts, credits, and image links as JSON. Images
          are linked, not included as an offline archive.
        </Text>
        <Button
          title={busy === "export" ? "Preparing…" : "Export my work as JSON"}
          secondary
          disabled={!!busy}
          onPress={() => void exportWork()}
          icon="download-outline"
        />
        {!!exportJson && (
          <>
            <Button
              title="Copy export JSON"
              secondary
              onPress={() =>
                void Clipboard.setStringAsync(exportJson)
                  .then(() => notify("JSON copied."))
                  .catch((e) => setError(messageOf(e)))
              }
            />
            {Platform.OS !== "web" && (
              <Button
                title="Share export JSON"
                secondary
                onPress={() =>
                  void Share.share({
                    message: exportJson,
                    title: "Crewroom work export",
                  }).catch((e) => setError(messageOf(e)))
                }
              />
            )}
            <Text style={x.small}>
              Keep image copies separately if you need a complete offline
              backup.
            </Text>
          </>
        )}
      </View>
      <View style={x.divider} />
      <Text style={x.sectionTitle}>Blocked creators</Text>
      <ErrorNotice
        message={blocked.error}
        retry={() => void blocked.reload()}
      />
      {blocked.loading ? (
        <Spinner />
      ) : blocked.data?.length ? (
        blocked.data.map((profile) => (
          <View key={profile.userId} style={x.toolbar}>
            <View style={x.grow}>
              <Text style={x.label}>{profile.displayName}</Text>
              <Text style={x.small}>@{profile.handle}</Text>
            </View>
            <Button
              title={busy === profile.userId ? "Unblocking…" : "Unblock"}
              small
              secondary
              disabled={!!busy}
              onPress={() => void unblock(profile.userId)}
            />
          </View>
        ))
      ) : (
        <Text style={x.body}>You haven’t blocked any creators.</Text>
      )}
    </Sheet>
  );
}
