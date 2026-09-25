export type Theme = "system" | "light" | "dark";
export type Page = "research" | "projects" | "files" | "reports" | "watchlist" | "reminders";
export type Phase = "idle" | "running" | "completed" | "stopped" | "failed";
export type Company = { ticker: string; name: string; logo?: string; color?: string };
export type Source = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  kind: "filing" | "web" | "file";
};
export type ResearchStep = {
  id: string;
  title: string;
  detail: string;
  status: "pending" | "running" | "done" | "error";
};
export type Attachment = {
  id: string;
  name: string;
  content?: string;
  mimeType?: string;
  data?: string;
  fileId?: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: Attachment[];
  phase?: Phase;
  sources?: Source[];
  steps?: ResearchStep[];
  fileIds?: string[];
  error?: string;
  time: number;
  runId?: string;
  engineRoundId?: string;
};
export type Session = {
  id: string;
  title: string;
  company?: Company;
  projectId?: string;
  messages: Message[];
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  origin: "demo" | "live";
  model?: string;
  loadingHistory?: boolean;
  historyError?: string;
  recoveryPending?: boolean;
};
export type Project = { id: string; name: string; description: string; createdAt: number };
export type ResearchFile = {
  id: string;
  name: string;
  folder: string;
  content: string;
  kind: "markdown" | "text";
  updatedAt: number;
  report?: boolean;
  projectId?: string;
  sessionId?: string;
  readOnly?: boolean;
  remoteUrl?: string;
};
export type WatchItem = {
  id: string;
  company: Company;
  type: "equity" | "contract";
  venue: string;
  note: string;
  group: string;
};
export type Reminder = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  createdAt: number;
};
export type Draft = { text: string; attachments: Attachment[] };
export type Notice = { id: string; text: string; tone: "info" | "error" };
