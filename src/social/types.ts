export type SocialVisibility = "public" | "private";
export type ContentReviewStatus = "pending" | "approved" | "rejected";
/** Review details are returned only to the owner of real public content. */
export interface ContentReview {
  reviewStatus?: ContentReviewStatus;
  reviewReason?: string;
}
export type CreativeStage = "wip" | "finished" | "tutorial";
export type CollaborationStatus =
  "pending" | "accepted" | "declined" | "cancelled";
export type CollaborationAction = "accept" | "decline" | "cancel";
export type ReportTarget = "post" | "profile" | "comment";
export type ReportReason = "harassment" | "stolen-work" | "spam" | "other";

export interface CreatorProfile extends ContentReview {
  userId: string;
  handle: string;
  displayName: string;
  bio: string;
  roles: string[];
  fandoms: string[];
  city: string;
  websiteUrl: string;
  instagramUrl: string;
  visibility: SocialVisibility;
  openToCollab: boolean;
  isExample: boolean;
  viewerFollowing: boolean;
  followerCount: number;
  projectCount: number;
}

export interface MediaAsset {
  /** Missing on older photo-only servers. */
  kind?: "image" | "video";
  duration?: number;
  posterUrl?: string;
  id: string;
  /** API-relative URL; unattached/private media requires owner authorization. */
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** Attribution entered by the uploader, not an identity or credit verification. */
export interface Credit {
  name: string;
  role: string;
  profileId?: string;
}

export interface Opportunity {
  role: string;
  city: string;
  eventName: string;
  date: string;
}

export interface CreativePost extends ContentReview {
  id: string;
  author: CreatorProfile;
  title: string;
  character: string;
  fandom: string;
  stage: CreativeStage;
  body: string;
  visibility: SocialVisibility;
  media: MediaAsset[];
  credits: Credit[];
  opportunity: Opportunity | null;
  createdAt: string;
  updatedAt: string;
  viewerSaved: boolean;
  commentCount: number;
  isExample: boolean;
}

export interface CreativeComment extends ContentReview {
  id: string;
  postId: string;
  author: CreatorProfile;
  body: string;
  createdAt: string;
}

export interface CollaborationRequest {
  id: string;
  sender: CreatorProfile;
  recipient: CreatorProfile;
  postId: string | null;
  title: string;
  role: string;
  message: string;
  status: CollaborationStatus;
  createdAt: string;
  crewId: string | null;
  projectId: string | null;
}

export interface SocialNotification {
  id: string;
  type: "follow" | "comment" | "request" | "accepted" | "declined";
  actor: CreatorProfile | null;
  text: string;
  postId: string | null;
  requestId: string | null;
  read: boolean;
  createdAt: string;
}

export interface FeedResult {
  items: CreativePost[];
  nextCursor: string | null;
}

export interface ProfileResult {
  profile: CreatorProfile;
  posts: CreativePost[];
}

export interface PostResult {
  post: CreativePost;
  comments: CreativeComment[];
}

export interface InboxResult {
  incoming: CollaborationRequest[];
  outgoing: CollaborationRequest[];
}

export interface CreatePostInput {
  title: string;
  character?: string;
  fandom?: string;
  stage: CreativeStage;
  body?: string;
  visibility: SocialVisibility;
  mediaIds: string[];
  mediaAlts?: string[];
  credits?: Credit[];
  opportunity?: Opportunity | null;
  publishProfile?: boolean;
}

export type UpdatePostInput = Partial<CreatePostInput>;

export interface UpdateProfileInput {
  handle?: string;
  displayName?: string;
  bio?: string;
  roles?: string[];
  fandoms?: string[];
  city?: string;
  websiteUrl?: string;
  instagramUrl?: string;
  visibility?: SocialVisibility;
  openToCollab?: boolean;
}

export interface FeedOptions {
  mediaType?: "image" | "video" | "all";
  mode?: "discover" | "following" | "saved";
  q?: string;
  stage?: CreativeStage;
  openRoles?: boolean;
  cursor?: string;
}

export interface ProfileOptions {
  q?: string;
  role?: string;
}

export interface UploadMediaInput {
  base64: string;
  mimeType: string;
}

export interface CreateRequestInput {
  recipientId: string;
  postId?: string;
  title: string;
  role: string;
  message: string;
}

export interface RespondRequestInput {
  action: CollaborationAction;
}

export interface ReportInput {
  targetType: ReportTarget;
  targetId: string;
  reason: ReportReason;
  details?: string;
}

/** JSON export includes media URLs, not a downloadable media archive. */
export type SocialExportResult = ProfileResult;
