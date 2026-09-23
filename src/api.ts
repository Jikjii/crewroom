import Constants from "expo-constants";
import { uploadNativeVideo } from "./videoUpload";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type {
  AcceptedInvite,
  Agenda,
  CreatedInvite,
  CreateAgendaInput,
  CreateCrewInput,
  CreateInviteInput,
  CreateLineupInput,
  CreateMemberInput,
  CreateProjectInput,
  CreateTaskInput,
  Crew,
  InvitePreview,
  Lineup,
  LoginInput,
  Member,
  Project,
  Session,
  SignupInput,
  Task,
  UpdateLineupInput,
  UpdateMemberInput,
  UpdateProjectInput,
  UpdateTaskInput,
  Workspace,
} from "./types";

const SESSION_STORAGE_KEY = "crewroom.session.v1";
const REQUEST_TIMEOUT_MS = 20_000;

let nativeToken: string | null = null;
let csrfToken: string | null = null;
let sessionKnown = false;
let nativeInitialization: Promise<void> | null = null;
let sessionRequest: Promise<Session> | null = null;

interface SessionResponse extends Session {
  sessionToken?: string;
}

export interface PublicConfig {
  resetAvailable: boolean;
  operator: string;
  supportEmail: string;
  minimumAge: number;
  privacyPolicyUrl: string;
  termsUrl: string;
  requirePolicyAcceptance: boolean;
  policyVersion: string;
}

export interface DeletionPreview {
  confirmationToken: string;
  ownedCrews: {
    id: string;
    name: string;
    action: "delete" | "transfer";
    successor: { userId: string; name: string } | null;
  }[];
  counts: { posts: number; comments: number; media: number };
  sharedCrewsPreserved: number;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

/** An actionable server or connection error suitable for an in-app message. */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function urlHostname(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** Hosted web uses its own origin; only local development uses port 4311. */
export function getApiBaseUrl(): string {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  if (Platform.OS === "web") {
    const browserLocation = (
      globalThis as unknown as {
        location?: { protocol?: string; hostname?: string; origin?: string };
      }
    ).location;
    if (!__DEV__ && browserLocation?.origin) return browserLocation.origin;
    const protocol =
      browserLocation?.protocol === "https:" ? "https:" : "http:";
    const hostname = browserLocation?.hostname || "localhost";
    return `${protocol}//${urlHostname(hostname)}:4311`;
  }

  if (!__DEV__) {
    throw new ApiError(
      "This build needs Crewroom’s hosted server address. Please install an updated build.",
    );
  }
  const hostUri = Constants.expoConfig?.hostUri?.trim();
  if (hostUri) {
    try {
      const parsedHost = new URL(
        hostUri.includes("://") ? hostUri : `http://${hostUri}`,
      );
      if (parsedHost.hostname) {
        return `http://${urlHostname(parsedHost.hostname)}:4311`;
      }
    } catch {
      // A missing/invalid Expo development host falls back to local development.
    }
  }
  return "http://localhost:4311";
}

async function initializeNativeAuth(): Promise<void> {
  if (Platform.OS === "web") return;
  if (!nativeInitialization) {
    nativeInitialization = SecureStore.getItemAsync(SESSION_STORAGE_KEY)
      .then((token) => {
        nativeToken = token;
      })
      .catch(() => {
        nativeInitialization = null;
        throw new ApiError(
          "Crewroom could not open your secure sign-in storage. Please try again.",
        );
      });
  }
  await nativeInitialization;
}

async function clearLocalAuth(): Promise<void> {
  nativeToken = null;
  csrfToken = null;
  sessionKnown = false;
  if (Platform.OS !== "web") {
    try {
      await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
    } catch {
      throw new ApiError(
        "Crewroom could not clear your saved sign-in. Please try signing out again.",
      );
    }
  }
}

async function rememberSession(
  response: SessionResponse,
  isAuthSuccess = false,
): Promise<Session> {
  if (!response.user) {
    await clearLocalAuth();
  } else if (Platform.OS !== "web" && isAuthSuccess) {
    if (!response.sessionToken) {
      throw new ApiError(
        "The server did not provide a mobile sign-in session. Please update the server and try again.",
      );
    }
    try {
      await SecureStore.setItemAsync(
        SESSION_STORAGE_KEY,
        response.sessionToken,
      );
    } catch {
      throw new ApiError(
        "Crewroom could not save your sign-in securely. Please try again.",
      );
    }
    nativeToken = response.sessionToken;
  }
  // Browser sessions use HttpOnly cookies. Never retain their bearer token.
  csrfToken = response.csrfToken;
  sessionKnown = true;
  return { user: response.user, csrfToken: response.csrfToken };
}

async function send<T>(path: string, options: RequestOptions = {}): Promise<T> {
  await initializeNativeAuth();
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (Platform.OS === "web") {
    if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  } else if (nativeToken) {
    headers.Authorization = `Bearer ${nativeToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  let responseText: string;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: Platform.OS === "web" ? "include" : "omit",
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(
        "Crewroom took too long to respond. Check your connection and try again.",
      );
    }
    throw new ApiError(
      __DEV__
        ? "Cannot reach Crewroom. Check your connection and make sure the API server is running. On a phone, use the same Wi-Fi as the server and its LAN address."
        : "Cannot reach Crewroom. Check your internet connection and try again in a moment.",
    );
  } finally {
    clearTimeout(timeout);
  }

  let data: unknown;
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new ApiError(
        "The server returned an unexpected response. Please try again.",
        response.status,
      );
    }
  }
  if (!response.ok) {
    const serverMessage =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : null;
    throw new ApiError(
      serverMessage ||
        (response.status === 401
          ? "Your session has expired. Please sign in again."
          : "Crewroom could not complete that request. Please try again."),
      response.status,
    );
  }
  return data as T;
}

async function getSession(): Promise<Session> {
  if (!sessionRequest) {
    sessionRequest = send<SessionResponse>("/api/session")
      .then((response) => rememberSession(response))
      .finally(() => {
        sessionRequest = null;
      });
  }
  return sessionRequest;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  // A cookie may survive a browser reload while its CSRF token does not.
  if (
    Platform.OS === "web" &&
    options.method &&
    options.method !== "GET" &&
    !sessionKnown
  ) {
    await getSession();
  }
  return send<T>(path, options);
}

async function authenticate(path: string, body?: unknown): Promise<Session> {
  const response = await request<SessionResponse>(path, {
    method: "POST",
    body,
  });
  return rememberSession(response, true);
}

const segment = (value: string): string => encodeURIComponent(value);

/** All methods load native credentials automatically and reject with ApiError. */
export const api = {
  getSession,
  getPublicConfig: (): Promise<PublicConfig> => request("/api/public-config"),
  requestPasswordReset: (
    email: string,
  ): Promise<{ ok: true; message: string }> =>
    request("/api/auth/password-reset/request", {
      method: "POST",
      body: { email },
    }),
  confirmPasswordReset: async (
    token: string,
    password: string,
  ): Promise<void> => {
    await request("/api/auth/password-reset/confirm", {
      method: "POST",
      body: { token, password },
    });
    await clearLocalAuth();
  },
  getDeletionPreview: (): Promise<DeletionPreview> =>
    request("/api/account/deletion-preview"),
  deleteAccount: async (
    password: string,
    confirmationToken: string,
  ): Promise<void> => {
    await request("/api/account", {
      method: "DELETE",
      body: { password, confirmationToken },
    });
    await clearLocalAuth();
  },

  startDemo: (): Promise<Session> => authenticate("/api/demo"),
  signup: (input: SignupInput): Promise<Session> =>
    authenticate("/api/auth/signup", input),
  login: (input: LoginInput): Promise<Session> =>
    authenticate("/api/auth/login", input),

  async logout(): Promise<void> {
    try {
      await request<unknown>("/api/auth/logout", { method: "POST" });
    } catch (error) {
      // An expired or revoked session is already signed out. Let the caller
      // leave that account instead of trapping it behind another 401 response.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    } finally {
      // Even if the server cannot be reached, forget this device's bearer token.
      // Browser logout still rejects if the server could not clear its cookie.
      await clearLocalAuth();
    }
  },

  getWorkspace: (): Promise<Workspace> => request("/api/workspace"),

  createCrew: (input: CreateCrewInput): Promise<Crew> =>
    request("/api/crews", { method: "POST", body: input }),

  createProject: (input: CreateProjectInput): Promise<Project> =>
    request("/api/projects", { method: "POST", body: input }),
  updateProject: (id: string, input: UpdateProjectInput): Promise<Project> =>
    request(`/api/projects/${segment(id)}`, { method: "PATCH", body: input }),

  createMember: (input: CreateMemberInput): Promise<Member> =>
    request("/api/members", { method: "POST", body: input }),
  updateMember: (id: string, input: UpdateMemberInput): Promise<Member> =>
    request(`/api/members/${segment(id)}`, { method: "PATCH", body: input }),
  async deleteMember(id: string): Promise<void> {
    await request(`/api/members/${segment(id)}`, { method: "DELETE" });
  },

  createLineup: (input: CreateLineupInput): Promise<Lineup> =>
    request("/api/lineup", { method: "POST", body: input }),
  updateLineup: (id: string, input: UpdateLineupInput): Promise<Lineup> =>
    request(`/api/lineup/${segment(id)}`, { method: "PATCH", body: input }),

  createTask: (input: CreateTaskInput): Promise<Task> =>
    request("/api/tasks", { method: "POST", body: input }),
  updateTask: (id: string, input: UpdateTaskInput): Promise<Task> =>
    request(`/api/tasks/${segment(id)}`, { method: "PATCH", body: input }),
  async deleteTask(id: string): Promise<void> {
    await request(`/api/tasks/${segment(id)}`, { method: "DELETE" });
  },

  createAgenda: (input: CreateAgendaInput): Promise<Agenda> =>
    request("/api/agenda", { method: "POST", body: input }),
  async deleteAgenda(id: string): Promise<void> {
    await request(`/api/agenda/${segment(id)}`, { method: "DELETE" });
  },

  createInvite: (
    crewId: string,
    input: CreateInviteInput = {},
  ): Promise<CreatedInvite> =>
    request(`/api/crews/${segment(crewId)}/invites`, {
      method: "POST",
      body: input,
    }),
  getInvite: (token: string): Promise<InvitePreview> =>
    request(`/api/invites/${segment(token)}`),
  acceptInvite: (token: string): Promise<AcceptedInvite> =>
    request(`/api/invites/${segment(token)}/accept`, { method: "POST" }),
  async revokeInvite(id: string): Promise<void> {
    await request(`/api/invites/${segment(id)}`, { method: "DELETE" });
  },
};

// Creative network requests use the same session and CSRF protection as crews.
import type {
  CreatorProfile,
  ProfileResult,
  ProfileOptions,
  FeedResult,
  FeedOptions,
  PostResult,
  CreativePost,
  CreativeComment,
  MediaAsset,
  CreatePostInput,
  UpdatePostInput,
  UpdateProfileInput,
  CreateRequestInput,
  CollaborationRequest,
  CollaborationAction,
  InboxResult,
  SocialNotification,
  ReportInput,
  SocialExportResult,
} from "./social/types";

function socialQuery(
  values: Record<string, string | boolean | undefined>,
): string {
  const search = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== false)
      search.set(key, value === true ? "1" : String(value));
  });
  return search.size ? `?${search.toString()}` : "";
}
export const socialApi = {
  getModerationConfig: (): Promise<import("./social/types").ModerationConfig> =>
    request("/api/social/moderation-config"),
  getMe: (): Promise<CreatorProfile> => request("/api/social/me"),
  updateMe: (input: UpdateProfileInput): Promise<CreatorProfile> =>
    request("/api/social/me", { method: "PATCH", body: input }),
  getProfiles: (options: ProfileOptions = {}): Promise<CreatorProfile[]> =>
    request(`/api/social/profiles${socialQuery({ ...options })}`),
  getProfile: (handle: string): Promise<ProfileResult> =>
    request(
      `/api/social/profiles/${segment(handle)}${Platform.OS !== "web" ? "?mediaType=all" : ""}`,
    ),
  getFeed: (options: FeedOptions = {}): Promise<FeedResult> =>
    request(
      `/api/social/feed${socialQuery({ mediaType: Platform.OS === "web" ? "image" : "all", ...options })}`,
    ),
  getPost: (id: string): Promise<PostResult> =>
    request(`/api/social/posts/${segment(id)}`),
  createPost: (input: CreatePostInput): Promise<CreativePost> =>
    request("/api/social/posts", { method: "POST", body: input }),
  updatePost: (id: string, input: UpdatePostInput): Promise<CreativePost> =>
    request(`/api/social/posts/${segment(id)}`, {
      method: "PATCH",
      body: input,
    }),
  deletePost: (id: string): Promise<{ ok: true }> =>
    request(`/api/social/posts/${segment(id)}`, { method: "DELETE" }),
  getVideoConfig: async (): Promise<{
    enabled: boolean;
    maxBytes: number;
    maxDuration: number;
  }> => {
    try {
      return await request("/api/social/video-config");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404)
        throw new ApiError(
          "Video is not available on this server yet. Please try again after the beta update.",
        );
      throw error;
    }
  },
  uploadVideo: async (uri: string, mimeType?: string): Promise<MediaAsset> => {
    await initializeNativeAuth();
    if (!nativeToken || Platform.OS === "web")
      throw new ApiError("Sign in in the Crewroom app to upload video.");
    return uploadNativeVideo(
      `${getApiBaseUrl()}/api/social/videos`,
      uri,
      nativeToken,
      mimeType,
    );
  },
  uploadMedia: (base64: string, mimeType: string): Promise<MediaAsset> =>
    request("/api/social/media", {
      method: "POST",
      body: { base64, mimeType },
    }),
  deleteUnusedMedia: (id: string): Promise<{ ok: true }> =>
    request(`/api/social/media/${segment(id)}`, { method: "DELETE" }),
  savePost: (id: string, saved: boolean): Promise<{ saved: boolean }> =>
    request(`/api/social/posts/${segment(id)}/save`, {
      method: "POST",
      body: { saved },
    }),
  followProfile: (
    userId: string,
    following: boolean,
  ): Promise<{ following: boolean }> =>
    request(`/api/social/profiles/${segment(userId)}/follow`, {
      method: "POST",
      body: { following },
    }),
  addComment: (postId: string, body: string): Promise<CreativeComment> =>
    request(`/api/social/posts/${segment(postId)}/comments`, {
      method: "POST",
      body: { body },
    }),
  deleteComment: (id: string): Promise<{ ok: true }> =>
    request(`/api/social/comments/${segment(id)}`, { method: "DELETE" }),
  createRequest: (input: CreateRequestInput): Promise<CollaborationRequest> =>
    request("/api/social/requests", { method: "POST", body: input }),
  getRequests: (): Promise<InboxResult> => request("/api/social/requests"),
  respondRequest: (
    id: string,
    action: CollaborationAction,
  ): Promise<CollaborationRequest> =>
    request(`/api/social/requests/${segment(id)}`, {
      method: "PATCH",
      body: { action },
    }),
  getNotifications: (): Promise<SocialNotification[]> =>
    request("/api/social/notifications"),
  markNotificationsRead: (ids?: string[]): Promise<{ ok: true }> =>
    request("/api/social/notifications/read", {
      method: "POST",
      body: ids ? { ids } : {},
    }),
  report: (input: ReportInput): Promise<{ ok: true }> =>
    request("/api/social/reports", { method: "POST", body: input }),
  getBlocks: (): Promise<CreatorProfile[]> => request("/api/social/blocks"),
  block: (userId: string): Promise<{ ok: true }> =>
    request("/api/social/blocks", { method: "POST", body: { userId } }),
  unblock: (userId: string): Promise<{ ok: true }> =>
    request(`/api/social/blocks/${segment(userId)}`, { method: "DELETE" }),
  exportOwn: (): Promise<SocialExportResult> => request("/api/social/export"),
};

/** Only attach credentials to this API's private media endpoint, never external URLs. */
export function mediaSource(
  asset: MediaAsset | string,
  options: { poster?: boolean } = {},
): {
  uri: string;
  headers?: Record<string, string>;
} {
  const path =
    typeof asset === "string"
      ? asset
      : options.poster && asset.posterUrl
        ? asset.posterUrl
        : asset.url;
  const base = getApiBaseUrl();
  const uri = path.startsWith("/") ? `${base}${path}` : path;
  const protectedMedia = uri.startsWith(`${base}/api/social/media/`);
  return Platform.OS !== "web" && nativeToken && protectedMedia
    ? { uri, headers: { Authorization: `Bearer ${nativeToken}` } }
    : { uri };
}

export function getPublicWebUrl(path: string): string {
  const configured = process.env.EXPO_PUBLIC_WEB_URL?.trim();
  let origin = configured?.replace(/\/+$/, "");
  if (!origin && Platform.OS === "web" && typeof window !== "undefined")
    origin = window.location.origin;
  if (!origin && !__DEV__) {
    throw new ApiError(
      "This build needs Crewroom’s public web address. Please install an updated build.",
    );
  }
  if (!origin) {
    const host = Constants.expoConfig?.hostUri;
    if (host) {
      try {
        origin = `http://${new URL(host.includes("://") ? host : `http://${host}`).host}`;
      } catch {}
    }
  }
  if (!origin) {
    const apiUrl = new URL(getApiBaseUrl());
    apiUrl.port = "8081";
    origin = apiUrl.origin;
  }
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
