import React, { useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { socialApi } from "../api";
import type { User } from "../types";
import { Button, Empty, Icon, Tag, useUI } from "../ui";
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
  const { C, s } = useUI();
  const x = useSocialStyles();
  const [tab, setTab] = useState<"incoming" | "outgoing" | "updates">(
      "incoming",
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
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
      <View style={{ gap: 9 }}>
        <Text style={x.eyebrow}>GOOD THINGS START WITH HELLO</Text>
        <Text style={x.title}>Make the connection.</Text>
        <Text style={x.intro}>
          Thoughtful invitations. A little conversation. Something new to make
          together.
        </Text>
      </View>
      {!user || user.isDemo ? (
        <AccountPrompt
          title="Your next collaborator is a conversation away"
          text="Create an account to send and receive real requests. Accepting creates a separate private crew for that collaboration."
          onPress={onAccount}
        />
      ) : (
        <>
          <View style={x.wrap}>
            <Choice
              label={`Incoming${resource.data?.requests.incoming.filter((r) => r.status === "pending").length ? ` (${resource.data.requests.incoming.filter((r) => r.status === "pending").length})` : ""}`}
              active={tab === "incoming"}
              onPress={() => setTab("incoming")}
            />
            <Choice
              label="Sent"
              active={tab === "outgoing"}
              onPress={() => setTab("outgoing")}
            />
            <Choice
              label={`Updates${resource.data?.notifications.some((n) => !n.read) ? " •" : ""}`}
              active={tab === "updates"}
              onPress={() => setTab("updates")}
            />
          </View>
          <ErrorNotice
            message={error || resource.error}
            retry={() => void resource.reload()}
          />
          {resource.loading && !resource.data ? (
            <Spinner />
          ) : tab === "updates" ? (
            <>
              {resource.data?.notifications.some((n) => !n.read) && (
                <Button
                  title={busy === "read" ? "Updating…" : "Mark all as read"}
                  secondary
                  disabled={!!busy}
                  onPress={() => void markAll()}
                />
              )}
              {resource.data?.notifications.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => void openNotification(item)}
                  style={[
                    x.card,
                    !item.read && {
                      borderColor: C.selectionBorder,
                      backgroundColor: C.pale,
                    },
                  ]}
                >
                  <View style={x.row}>
                    <Icon
                      name={
                        item.type === "comment"
                          ? "chatbubble-outline"
                          : item.type === "follow"
                            ? "person-add-outline"
                            : "people-outline"
                      }
                      color={C.blue}
                    />
                    <Text style={[x.body, { flex: 1, color: C.ink }]}>
                      {item.text}
                    </Text>
                    {!item.read && (
                      <View
                        accessibilityLabel="Unread notification"
                        style={x.unread}
                      />
                    )}
                  </View>
                  <Text style={x.small}>
                    {new Date(item.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                </Pressable>
              ))}
              {!resource.data?.notifications.length && (
                <Empty
                  icon="notifications-outline"
                  title="A little quiet, in a good way"
                  text="Real follows, comments, and collaboration updates will appear here."
                />
              )}
            </>
          ) : (
            <>
              {resource.data?.requests[tab].map((request) => {
                const person =
                  tab === "incoming" ? request.sender : request.recipient;
                return (
                  <View key={request.id} style={x.card}>
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
                    <Text style={x.eyebrow}>{request.role}</Text>
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
                          <View style={x.row}>
                            <View style={x.grow}>
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
