/** Calendar dates and clock times stay as local strings; do not convert to UTC. */
export type LocalDate = string;
export type LocalTime = string;
export type ReadinessStatus = "planning" | "making" | "ready";

export interface User {
  id: string;
  name: string;
  /** Private demo accounts do not have an email address yet. */
  email: string | null;
  isDemo: boolean;
}

export interface Session {
  user: User | null;
  csrfToken: string | null;
}

export interface Crew {
  id: string;
  name: string;
  description: string;
  color: string;
  ownerId: string;
  createdAt: string;
}

export interface Project {
  id: string;
  crewId: string;
  title: string;
  fandom: string;
  eventName: string;
  date: LocalDate;
  time: LocalTime;
  location: string;
  description: string;
  color: string;
  createdAt: string;
}

export interface Member {
  id: string;
  crewId: string;
  userId: string | null;
  name: string;
  role: string;
  color: string;
  isPlaceholder: boolean;
}

export interface Lineup {
  id: string;
  projectId: string;
  memberId: string;
  character: string;
  status: ReadinessStatus;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  assigneeId: string | null;
  done: boolean;
  dueDate: LocalDate | null;
  createdAt: string;
}

export interface Agenda {
  id: string;
  projectId: string;
  time: LocalTime;
  title: string;
  location: string;
  notes: string;
}

export interface Activity {
  id: string;
  crewId: string;
  actorName: string;
  text: string;
  createdAt: string;
}

export interface Workspace {
  crews: Crew[];
  projects: Project[];
  members: Member[];
  lineup: Lineup[];
  tasks: Task[];
  agenda: Agenda[];
  activity: Activity[];
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface SignupInput extends LoginInput {
  name: string;
  policyAccepted?: boolean;
  ageConfirmed?: boolean;
  policyVersion?: string;
}

export interface CreateCrewInput {
  name: string;
  description?: string;
  color?: string;
}

export interface CreateProjectInput {
  crewId: string;
  title: string;
  fandom?: string;
  eventName?: string;
  date?: LocalDate;
  time?: LocalTime;
  location?: string;
  description?: string;
  color?: string;
}

export type UpdateProjectInput = Partial<Omit<CreateProjectInput, "crewId">>;

/** A planned member is a placeholder, not an account or a sent invitation. */
export interface CreateMemberInput {
  crewId: string;
  name: string;
  role?: string;
  color?: string;
}

export interface UpdateMemberInput {
  role?: string;
}

export interface CreateLineupInput {
  projectId: string;
  memberId: string;
  character?: string;
  status?: ReadinessStatus;
}

export type UpdateLineupInput = Partial<Pick<Lineup, "character" | "status">>;

export interface CreateTaskInput {
  projectId: string;
  title: string;
  assigneeId?: string | null;
  dueDate?: LocalDate | null;
}

export type UpdateTaskInput = Partial<
  Pick<Task, "title" | "done" | "assigneeId" | "dueDate">
>;

export interface CreateAgendaInput {
  projectId: string;
  time: LocalTime;
  title: string;
  location?: string;
  notes?: string;
}

export interface CreateInviteInput {
  /** Claim this planned member when accepting, preserving their assignments. */
  memberId?: string;
}

export interface CreatedInvite {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
}

export interface InvitePreview {
  crewName: string;
  inviterName: string;
  expiresAt: string;
}

export interface AcceptedInvite {
  crewId: string;
}
