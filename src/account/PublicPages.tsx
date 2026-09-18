import React from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { type PublicConfig, getPublicWebUrl } from "../api";
import { Button, useUI } from "../ui";

export type PublicPage = "privacy" | "terms" | "community" | "support" | "delete-account" | "reset-password";
export const pageTitles: Record<PublicPage, string> = {
  privacy: "Privacy", terms: "Beta terms", community: "Community standards", support: "Support",
  "delete-account": "Account & privacy", "reset-password": "Reset your password",
};
export function parsePublicPage(url: string | null): { page: PublicPage; token?: string } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const path = (parsed.protocol === "crewroom:" ? `/${parsed.host}${parsed.pathname}` : parsed.pathname).replace(/\/+$/, "");
    const page = path.slice(1) as PublicPage;
    return Object.hasOwn(pageTitles, page) ? { page, token: parsed.searchParams.get("token") || undefined } : null;
  } catch { return null; }
}

export function PolicyLinks({ onOpen, config }: { onOpen?: (page: PublicPage) => void; config?: PublicConfig | null }) {
  const { s } = useUI();
  const [error, setError] = React.useState("");
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
      {(["privacy", "terms", "community", "support"] as PublicPage[]).map((page) => <Pressable key={page} accessibilityRole="link" onPress={() => {
        try {
          const defaultUrl = getPublicWebUrl(`/${page}`);
          const configuredUrl = page === "privacy" ? config?.privacyPolicyUrl : page === "terms" ? config?.termsUrl : undefined;
          const url = configuredUrl || defaultUrl;
          if (onOpen && url === defaultUrl) onOpen(page);
          else { void Linking.openURL(url).catch(() => setError("Could not open this page. Visit Crewroom’s website for help.")); }
        } catch (e) { setError((e as Error).message); }
      }} style={{ paddingVertical: 8 }}><Text style={s.link}>{pageTitles[page]}</Text></Pressable>)}
    </View>
    {error ? <Text accessibilityRole="alert" style={s.small}>{error}</Text> : null}
  </View>;
}

export function PublicPageContent({ page, config, onOpen, children }: {
  page: PublicPage; config: PublicConfig | null; onOpen: (page: PublicPage) => void; children?: React.ReactNode;
}) {
  const { C, s } = useUI();
  const [error, setError] = React.useState("");
  const section = (title: string, text: string) => <View style={{ gap: 8 }} key={title}>
    <Text style={s.h3}>{title}</Text><Text style={s.body}>{text}</Text>
  </View>;
  const draft = !config?.requirePolicyAcceptance || !config?.operator || !config?.supportEmail;
  const contact = config?.supportEmail || "A public support address has not been configured yet.";
  return <View style={{ gap: 24 }}>
    <Text style={s.eyebrow}>Crewroom · {config?.policyVersion || "beta-1"}</Text>
    <Text style={s.h1}>{pageTitles[page]}</Text>
    {draft && ["privacy", "terms", "community", "support"].includes(page) ? <View style={[s.card, { backgroundColor: C.peach }]}>
      <Text style={[s.body, { color: C.orange }]}>Local beta draft. The operator must review these pages and add real support details before a public launch.</Text>
    </View> : null}
    {page === "privacy" ? <>
      {section("Who runs Crewroom", `${config?.operator || "Operator not yet configured"} operates this beta. Contact: ${contact}`)}
      {section("What we store and why", "We store your name, email, a salted password hash, sign-in sessions, and the information you choose to add: your creator profile, posts, photos, comments, follows, saves, collaboration requests, crew memberships, plans, assignments, and invitations. This lets you sign in, find creators, share work, and coordinate private crews. Report and block records help us handle abuse. If signup consent is required, we record the policy version and your age and terms confirmation.")}
      {section("What other people can see", "Profiles start private. Public profiles, posts, and comments go through operator review before other people can see them; public edits are reviewed again. Approved public content is available to people without an account and may be indexed or copied. Credits on approved public posts are public. Shared crews, tasks, lineup and day plans are available to crew members. Collaboration requests are visible to the people involved; accepting one creates a new private shared crew. Your account email and password are not published on your profile.")}
      {section("Photos and device storage", "Crewroom accesses only photos you choose. Uploaded photos are resized and converted for display; originals and embedded location metadata are not retained by the upload pipeline. Browser sign-in uses an essential HttpOnly cookie; native sign-in uses secure device storage. Your appearance choice is saved on your device. This beta does not include advertising trackers or sell personal information.")}
      {section("Hosting and email", "Our hosting provider processes the service’s database, photos, and operational traffic. When enabled, our email provider processes your email address to deliver password-reset links. We use IP addresses for short-lived abuse rate limits. Hosting providers may keep their own access and security logs. Access to administrative tools is restricted to the operator.")}
      {section("Your choices and deletion", "You can edit or unpublish your profile and work, remove your posts and comments, block creators, and export your creator profile and work from Settings. You can delete your account in Account & privacy or on the website’s deletion page. The confirmation explains crew ownership transfers and crew deletion. Live account, profile, posts, comments, uploads, sessions and relationship data are removed; shared plans remain for other members. Historical actor labels are anonymized where the service records them. Text or credits written by other people and copies they saved may remain; contact support to request review.")}
      {section("Backups and retention", "Account data stays in the live service until you remove it or delete your account. The beta operator must expire backup snapshots within 30 days and reapply deletions if a snapshot is restored. Backups are restricted to recovery use. If a legal obligation requires different retention, the operator will explain the applicable exception to the affected user where permitted. Contact support for access, correction, deletion, or questions about hosting locations and provider logs.")}
      {section("Age and policy changes", `This beta is intended for people ${config?.minimumAge || 18} or older. Do not register if you are below the minimum age. Contact support if an underage account or child-safety concern is discovered. Material policy changes will be announced in the service; the policy version appears at the top of this page.`)}
      <Button title="Manage or delete my account" secondary onPress={() => onOpen("delete-account")} />
    </> : page === "terms" ? <>
      {section("A beta for making things together", `Crewroom is operated by ${config?.operator || "the operator (not yet configured)"}. You must be at least ${config?.minimumAge || 18} and accept these terms and the Community standards to register. Keep your account credentials private and provide an email you can access. The service is under active development; features may change or be interrupted.`)}
      {section("Your work stays yours", "You retain your rights to your photos, costumes, writing, and other work. You give Crewroom permission to store, resize, display and share it according to the visibility and collaboration features you choose, for the purpose of operating the service. Upload only material you own or have permission to share, including permission from photographers and identifiable people. Credit contributors accurately. Crewroom does not claim ownership of the characters or franchises represented in cosplay.")}
      {section("Working with other creators", "A collaboration request is an invitation to discuss a project. Crewroom does not verify every member or guarantee attendance, payment, safety, image rights, or the quality of a collaboration. Agree separately on consent, location, deliverables, credits, compensation and permitted photo use. Do not publish private schedules or addresses without permission.")}
      {section("Community and moderation", "Follow the Community standards. Use the reporting and blocking tools when needed. The operator may remove content or restrict accounts for violations and may review reports and relevant information to investigate abuse. Contact support if you believe a moderation decision was mistaken. Emergency services, rather than this app, should be used for immediate danger.")}
      {section("Leaving and changes", "You can unpublish your work or delete your account. The deletion preview explains what happens to shared crews. Other members’ records and copies outside Crewroom may remain. Material changes to these terms will be announced in the service. These beta terms do not limit rights that applicable law does not allow to be waived.")}
      <Button title="Read community standards" secondary onPress={() => onOpen("community")} />
    </> : page === "community" ? <>
      {section("Respect creators and consent", "Welcome cosplayers, photographers, makers and fans across backgrounds and skill levels. No harassment, hate, threats, stalking, impersonation, doxxing, scams or unwanted sexual contact. Do not share someone’s private location, schedule or contact details without their consent.")}
      {section("Keep the beta suitable for a creative community", "No pornography, sexual services, sexually exploitative content, graphic violence, or promotion of illegal activity. Costume content must comply with these rules. No child sexual abuse or exploitation in any form, including grooming, sexualization of minors or sharing exploitative imagery. These restrictions apply regardless of the beta’s adult minimum age.")}
      {section("Share work you have permission to share", "Respect copyright, photographer agreements, model consent and credits. Do not present someone else’s work as your own. Do not upload intimate images without consent, spam, or deceptive engagement schemes.")}
      {section("Report a concern", "Use Report on a post, comment or creator profile. Block a creator to restrict interaction. For concerns you cannot report in-app, use the support email below; include a link and description, and do not email illegal imagery. The beta uses operator review; immediate responses are not guaranteed. For urgent danger, contact local emergency services.")}
      {section("Before public sharing", "New public profiles, posts, and comments wait for operator review against these standards. Changes to public content require another review and stay hidden from other people until approved. You can see the review status of your own submissions; private drafts remain available to you immediately. This is human review, not an automated image classifier. Contact support if you disagree with a review decision.")}
      {section("Operator response", "The operator reviews reports, restricts or removes violating material and accounts, and handles appeals through support. Suspected child sexual abuse material must be escalated to the operator’s child-safety contact and handled under applicable reporting and preservation obligations. The operator must designate and train that contact before public release.")}
      <Button title="Contact support" secondary onPress={() => onOpen("support")} />
    </> : page === "support" ? <>
      {section("Something not working?", "Include your device, what you were trying to do, and any error message. Never send your password, reset link, private invitation token, or payment credentials.")}
      <Text selectable style={s.body}>{contact}</Text>
      {config?.supportEmail ? <Button title="Email Crewroom support" onPress={() => void Linking.openURL(`mailto:${config.supportEmail}`).catch(() => setError(`Email ${config.supportEmail} using your mail app.`))} /> : null}
      {section("Safety and privacy requests", "Use the same support address for privacy questions, deletion assistance, moderation appeals, copyright concerns and child-safety escalation. Include the relevant profile or post link. Reports can also be sent inside the app. This beta does not offer round-the-clock support.")}
      <Button title="Delete an account on the web" secondary onPress={() => onOpen("delete-account")} />
    </> : children}
    {error ? <Text style={{ color: C.danger }} accessibilityRole="alert">{error}</Text> : null}
    <View style={s.divider} />
    <PolicyLinks onOpen={onOpen} config={config} />
  </View>;
}
