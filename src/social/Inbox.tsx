import React, { useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { mediaSource, socialApi } from "../api";
import type { User } from "../types";
import { Avatar, Button, Empty, Icon, Tag, useUI } from "../ui";
import type {
  CollaborationAction,
  CollaborationRequest,
  SocialNotification,
} from "./types";
import {
  AccountPrompt,
  Choice,
  ErrorNotice,
  ProfileLink,
  Spinner,
  messageOf,
  useResource,
} from "./shared";
import { useSocialStyles } from "./styles";

export default function Inbox({
  user,
  revision,
  onAccount,
  onPost,
  onProfile,
  onProject,
  onChanged,
  notify,
}: {
  user: User | null;
  revision: number;
  onAccount: () => void;
  onPost: (id: string) => void;
  onProfile: (handle: string) => void;
  onProject: (id: string) => void;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const { C } = useUI();
  const x = useSocialStyles();
  const [tab, setTab] = useState<"incoming" | "outgoing" | "updates">(
      "updates",
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [filter, setFilter] = useState<
    "all" | "comment" | "follow" | "collaboration"
  >("all");
  const lock = useRef(false);
  const resource = useResource(async () => {
    if (!user || user.isDemo)
      return { requests: { incoming: [], outgoing: [] }, notifications: [] };
    const [requests, notifications] = await Promise.all([
      socialApi.getRequests(),
      socialApi.getNotifications(),
    ]);
    return { requests, notifications };
  }, [user?.id, user?.isDemo, revision]);
  const act = async (
    request: CollaborationRequest,
    action: CollaborationAction,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(request.id);
    setError("");
    try {
      const next = await socialApi.respondRequest(request.id, action);
      await resource.reload();
      onChanged();
      if (action === "accept" && next.projectId) {
        notify("Your new private crew and plan are ready.");
        onProject(next.projectId);
      } else
        notify(
          action === "decline" ? "Request declined." : "Request cancelled.",
        );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  const openNotification = async (item: SocialNotification) => {
    setError("");
    try {
      if (!item.read) await socialApi.markNotificationsRead([item.id]);
      const latest = await resource.reload();
      onChanged();
      if (item.requestId)
        setTab(
          (latest || resource.data)?.requests.outgoing.some(
            (request) => request.id === item.requestId,
          )
            ? "outgoing"
            : "incoming",
        );
      else if (item.postId) onPost(item.postId);
      else if (item.actor) onProfile(item.actor.handle);
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const markAll = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy("read");
    setError("");
    try {
      await socialApi.markNotificationsRead();
      await resource.reload();
      onChanged();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      lock.current = false;
      setBusy("");
    }
  };
  const unreadCount =
    resource.data?.notifications.filter((item) => !item.read).length || 0;
  const incomingCount =
    resource.data?.requests.incoming.filter(
      (request) => request.status === "pending",
    ).length || 0;
  const notifications = (resource.data?.notifications || []).filter(
    (item) =>
      filter === "all" ||
      (filter === "collaboration"
        ? item.type === "request" ||
          item.type === "accepted" ||
          item.type === "declined"
        : item.type === filter),
  );
  const timeLabel = (value: string) => {
    const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
    if (elapsed < 60000) return "Just now";
    if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`;
    if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`;
    if (elapsed < 604800000) return `${Math.floor(elapsed / 86400000)}d ago`;
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };
  return (
    <ScrollView
      contentContainerStyle={x.content}
      refreshControl={
        <RefreshControl
          refreshing={resource.loading && !!resource.data}
          onRefresh={() => void resource.reload()}
          tintColor={C.blue}
        />
      }
    >
      <View style={[x.toolbar, { alignItems: "flex-start" }]}>
        <View style={{ flex: 1, gap: 7 }}>
          <Text style={x.eyebrow}>YOUR CREATIVE CIRCLE</Text>
          <Text style={x.title}>Alerts</Text>
          <Text style={x.intro}>
            The conversation behind your next creation.
          </Text>
        </View>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: C.pale,
            borderWidth: 1,
            borderColor: C.line,
          }}
        >
          <Icon name="notifications-outline" size={25} color={C.blue} />
          {unreadCount > 0 && (
            <View
              style={[x.unread, { position: "absolute", top: 10, right: 10 }]}
            />
          )}
        </View>
      </View>
      {!user || user.isDemo ? (
        <AccountPrompt
          title="Your next collaborator is a conversation away"
          text="Create an account to send and receive real requests. Accepting creates a separate private crew for that collaboration."
          onPress={onAccount}
        />
      ) : (
        <>
          <View accessibilityRole="tablist" style={[x.tabRow, { gap: 20 }]}>
            {(
              [
                [
                  "updates",
                  `Activity${unreadCount ? ` · ${unreadCount}` : ""}`,
                ],
                [
                  "incoming",
                  `Requests${incomingCount ? ` · ${incomingCount}` : ""}`,
                ],
                ["outgoing", "Sent"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === value }}
                aria-selected={tab === value}
                onPress={() => setTab(value)}
                style={[x.textTab, tab === value && x.textTabActive]}
              >
                <Text
                  style={{
                    color: tab === value ? C.ink : C.muted,
                    fontWeight: "700",
                    fontSize: 15,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <ErrorNotice
            message={error || resource.error}
            retry={() => void resource.reload()}
          />
          {resource.loading && !resource.data ? (
            <Spinner />
          ) : tab === "updates" ? (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {(
                  [
                    ["all", "All"],
                    ["comment", "Comments"],
                    ["follow", "Follows"],
                    ["collaboration", "Collaborations"],
                  ] as const
                ).map(([value, label]) => (
                  <Choice
                    key={value}
                    label={label}
                    active={filter === value}
                    onPress={() => setFilter(value)}
                  />
                ))}
              </ScrollView>
              {unreadCount > 0 && (
                <View style={x.toolbar}>
                  <Text style={x.small}>
                    {unreadCount} unread{" "}
                    {unreadCount === 1 ? "update" : "updates"}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!!busy}
                    onPress={() => void markAll()}
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    <Text style={x.link}>
                      {busy === "read" ? "Updating…" : "Mark all as read"}
                    </Text>
                  </Pressable>
                </View>
              )}
              <View style={{ gap: 10 }}>
                {notifications.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.read ? "" : "Unread. "}${item.text}. ${timeLabel(item.createdAt)}`}
                    onPress={() => void openNotification(item)}
                    style={({ pressed }) => [
                      x.card,
                      {
                        padding: 16,
                        borderRadius: 22,
                        opacity: pressed ? 0.8 : 1,
                      },
                      !item.read && { borderColor: C.selectionBorder },
                    ]}
                  >
                    <View
                      style={[x.row, { alignItems: "flex-start", gap: 13 }]}
                    >
                      <View
                        style={{
                          padding: 2,
                          borderWidth: 1.5,
                          borderColor: item.read ? C.line : C.blue,
                          borderRadius: 28,
                        }}
                      >
                        {item.actor ? (
                          <Avatar
                            name={item.actor.displayName}
                            source={item.actor.avatar ? mediaSource(item.actor.avatar) : undefined}
                            size={42}
                          />
                        ) : (
                          <View
                            style={{
                              width: 42,
                              height: 42,
                              borderRadius: 21,
                              backgroundColor: C.pale,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Icon name="sparkles-outline" color={C.blue} />
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1, gap: 7 }}>
                        <Text
                          style={[x.body, { color: C.ink, lineHeight: 23 }]}
                        >
                          {item.text}
                        </Text>
                        <View style={[x.row, { gap: 6 }]}>
                          <Icon
                            name={
                              item.type === "comment"
                                ? "chatbubble-outline"
                                : item.type === "follow"
                                  ? "person-add-outline"
                                  : "people-outline"
                            }
                            color={C.muted}
                            size={13}
                          />
                          <Text style={x.small}>
                            {timeLabel(item.createdAt)}
                          </Text>
                        </View>
                      </View>
                      {!item.read && (
                        <View
                          accessibilityLabel="Unread notification"
                          style={[x.unread, { marginTop: 7 }]}
                        />
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>
              {!notifications.length && (
                <Empty
                  icon={
                    filter === "comment"
                      ? "chatbubble-outline"
                      : filter === "follow"
                        ? "person-add-outline"
                        : filter === "collaboration"
                          ? "people-outline"
                          : "notifications-outline"
                  }
                  title={
                    filter === "all"
                      ? "Your circle starts here"
                      : filter === "comment"
                        ? "No comments yet"
                        : filter === "follow"
                          ? "No new follows yet"
                          : "No collaboration updates yet"
                  }
                  text={
                    filter === "all"
                      ? "Real follows, comments, and collaboration updates will appear here."
                      : "When there’s something new, you’ll find it here. Pull down to refresh."
                  }
                />
              )}
            </>
          ) : (
            <>
              <View style={{ gap: 5 }}>
                <Text style={x.sectionTitle}>
                  {tab === "incoming"
                    ? "Make something together"
                    : "Ideas you’ve sent"}
                </Text>
                <Text style={x.small}>
                  {tab === "incoming"
                    ? "Accept an invitation to start a private crew and plan."
                    : "Keep up with your collaboration invitations."}
                </Text>
              </View>
              {resource.data?.requests[tab].map((request) => {
                const person =
                  tab === "incoming" ? request.sender : request.recipient;
                return (
                  <View
                    key={request.id}
                    style={[x.card, { borderRadius: 24, gap: 16 }]}
                  >
                    <View style={x.toolbar}>
                      <ProfileLink
                        profile={person}
                        onPress={() => onProfile(person.handle)}
                      />
                      <Tag
                        tone={
                          request.status === "accepted"
                            ? "green"
                            : request.status === "pending"
                              ? "blue"
                              : "muted"
                        }
                      >
                        {request.status}
                      </Tag>
                    </View>
                    <Text style={x.sectionTitle}>{request.title}</Text>
                    <View style={x.wrap}>
                      <Tag>{request.role}</Tag>
                      <Text style={[x.small, { alignSelf: "center" }]}>
                        {timeLabel(request.createdAt)}
                      </Text>
                    </View>
                    <Text style={x.body}>{request.message}</Text>
                    {request.postId && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => onPost(request.postId!)}
                        style={[x.row, { minHeight: 44 }]}
                      >
                        <Text style={x.link}>See the project</Text>
                        <Icon name="arrow-forward" color={C.blue} size={16} />
                      </Pressable>
                    )}
                    {request.status === "pending" &&
                      (tab === "incoming" ? (
                        <>
                          <Text style={x.small}>
                            Accepting starts a new private crew and plan with
                            this person. Your existing crews remain private.
                          </Text>
                          <View style={{ gap: 10 }}>
                            <View>
                              <Button
                                title={
                                  busy === request.id
                                    ? "One moment…"
                                    : "Accept & start a plan"
                                }
                                disabled={!!busy}
                                onPress={() => void act(request, "accept")}
                              />
                            </View>
                            <Button
                              title="Decline"
                              secondary
                              disabled={!!busy}
                              onPress={() => void act(request, "decline")}
                            />
                          </View>
                        </>
                      ) : (
                        <Button
                          title={
                            busy === request.id
                              ? "Cancelling…"
                              : "Cancel request"
                          }
                          secondary
                          disabled={!!busy}
                          onPress={() => void act(request, "cancel")}
                        />
                      ))}
                    {request.status === "accepted" && request.projectId && (
                      <Button
                        title="Open your private plan"
                        icon="arrow-forward"
                        secondary
                        onPress={() => onProject(request.projectId!)}
                      />
                    )}
                  </View>
                );
              })}
              {!resource.data?.requests[tab].length && (
                <Empty
                  icon="paper-plane-outline"
                  title={
                    tab === "incoming"
                      ? "The right kind of invitation"
                      : "An idea worth reaching out for"
                  }
                  text={
                    tab === "incoming"
                      ? "Requests from real creators will appear here. Make your public profile open to collaboration so people know you’re interested."
                      : "Find a creator or an open project and send a thoughtful proposal."
                  }
                />
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
