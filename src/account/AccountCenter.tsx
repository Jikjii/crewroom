import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { api, ApiError, type DeletionPreview, type PublicConfig } from "../api";
import type { User } from "../types";
import { Button, Field, Icon, useUI } from "../ui";

export function PasswordRecovery({ config, onSignIn, token, onReset, backLabel = "Back to sign in" }: {
  config: PublicConfig | null; onSignIn: () => void; token?: string; onReset?: () => void; backLabel?: string;
}) {
  const { C, s } = useUI();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit() {
    if (busy) return;
    setError("");
    if (token && password !== confirm) { setError("The passwords don’t match."); return; }
    if (token && password.length < 10) { setError("Choose a password with at least 10 characters."); return; }
    if (!token && !email.trim()) { setError("Enter your account email."); return; }
    setBusy(true);
    try {
      if (token) {
        await api.confirmPasswordReset(token, password);
        setPassword(""); setConfirm("");
        setMessage("Your password has been changed. Sign in again on each device.");
        onReset?.();
      } else {
        const result = await api.requestPasswordReset(email.trim());
        setMessage(result.message);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 18 }}>
    <Text style={s.h2}>{token ? "Choose a new password" : "Get back to your crew"}</Text>
    <Text style={s.body}>{token ? "Your reset link works once. Changing your password signs out every device." : "Reset your password using a private email link."}</Text>
    {message ? <Text accessibilityRole="alert" style={[s.body, { color: C.green }]}>{message}</Text> : token ? <>
      <Field label="New password (10+ characters)" value={password} onChange={setPassword} secret />
      <Field label="Confirm new password" value={confirm} onChange={setConfirm} secret />
      <Button title={busy ? "Updating…" : "Save new password"} onPress={() => void submit()} disabled={busy} />
    </> : config?.resetAvailable ? <>
      <Field label="Account email" value={email} onChange={setEmail} keyboard="email-address" />
      <Button title={busy ? "Requesting…" : "Send reset link"} onPress={() => void submit()} disabled={busy} />
    </> : <View style={s.card}>
      <Text style={s.body}>{config ? "Email recovery hasn’t been enabled for this beta yet." : "Account recovery settings are not available. Check your connection and try again."}</Text>
      {config?.supportEmail ? <Button title="Contact support" secondary onPress={() => void Linking.openURL(`mailto:${config.supportEmail}`).catch(() => setError(`Email ${config.supportEmail} for help.`))} /> : null}
    </View>}
    {error ? <Text accessibilityRole="alert" style={{ color: C.danger }}>{error}</Text> : null}
    <Button title={backLabel} secondary onPress={onSignIn} disabled={busy} />
  </View>;
}

export function AccountCenter({ user, config, onDeleted, onSignIn }: {
  user: User | null; config: PublicConfig | null; onDeleted: () => void; onSignIn: () => void;
}) {
  const { C, s } = useUI();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!reviewing || !user) return;
    let active = true;
    setLoading(true); setError(""); setConfirmed(false);
    void api.getDeletionPreview().then((next) => { if (active) setPreview(next); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reviewing, user?.id, retry]);
  async function remove() {
    if (!confirmed || !preview || busy) return;
    setBusy(true); setError("");
    try { await api.deleteAccount(password, preview.confirmationToken); onDeleted(); }
    catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) { setPreview(null); setConfirmed(false); }
    }
    finally { setBusy(false); }
  }
  if (!user) return <View style={{ gap: 18 }}>
    <Text style={s.h2}>Delete your Crewroom account</Text>
    <Text style={s.body}>Sign in to confirm which account to delete. You can review what happens to your posts, photos, and shared crews before deleting. You do not need to install the app.</Text>
    <Button title="Sign in to continue" onPress={onSignIn} />
  </View>;
  if (recovery) return <PasswordRecovery config={config} onSignIn={() => setRecovery(false)} backLabel="Back to my account" />;
  return <View style={{ gap: 18 }}>
    <Text style={s.h2}>{reviewing ? "Review account deletion" : "Your account"}</Text>
    <Text style={s.body}>{user.email || "Private demo workspace"}</Text>
    {!reviewing ? <>
      {!user.isDemo ? <Button title="Reset password by email" secondary onPress={() => setRecovery(true)} /> : null}
      <View style={s.card}>
        <Icon name="trash-outline" color={C.danger} size={26} />
        <Text style={s.h3}>Leave Crewroom</Text>
        <Text style={s.body}>Permanently remove your profile, posts, uploaded photos, and account. Review how shared crews are handled first.</Text>
        <Button title="Review deletion" secondary onPress={() => setReviewing(true)} />
      </View>
    </> : <>
      {loading ? <ActivityIndicator color={C.blue} /> : preview ? <>
        <View style={s.card}>
          <Text style={s.h3}>What will be removed</Text>
          <Text style={s.body}>Your account and profile, {preview.counts.posts} posts, {preview.counts.comments} comments, and {preview.counts.media} uploaded photos. Your sessions, follows, saves, and collaboration requests will also be removed.</Text>
          <Text style={s.body}>You will leave your shared crews. Their other members’ plans and tasks stay; your task assignments and lineup entries are removed.</Text>
        </View>
        {preview.ownedCrews.map((crew) => <View key={crew.id} style={s.card}>
          <Text style={s.h3}>{crew.name}</Text>
          <Text style={s.body}>{crew.action === "transfer" ? `Ownership will transfer to ${crew.successor?.name}. Shared plans stay available to the remaining members.` : "This crew has no other real account to take ownership. The crew and all its plans will be deleted."}</Text>
        </View>)}
        <Text style={s.small}>The current crew membership is checked again when you confirm. Copies saved by other people cannot be recalled. See Privacy for backup handling.</Text>
        {!user.isDemo ? <Field label="Current password" value={password} onChange={setPassword} secret /> : null}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} aria-checked={confirmed} onPress={() => setConfirmed(!confirmed)} style={[s.row, { alignItems: "flex-start", paddingVertical: 8 }]}>
          <Icon name={confirmed ? "checkbox" : "square-outline"} color={C.danger} />
          <Text style={[s.body, { flex: 1 }]}>I understand that account deletion is permanent, including the crew changes listed above.</Text>
        </Pressable>
        <Button title={busy ? "Deleting…" : "Permanently delete my account"} onPress={() => void remove()} disabled={busy || !confirmed || (!user.isDemo && !password)} />
      </> : <Button title="Retry deletion preview" secondary onPress={() => setRetry(retry + 1)} />}
      <Button title="Keep my account" secondary disabled={busy} onPress={() => { setReviewing(false); setPassword(""); setConfirmed(false); }} />
    </>}
    {error ? <Text accessibilityRole="alert" style={{ color: C.danger }}>{error}</Text> : null}
  </View>;
}
