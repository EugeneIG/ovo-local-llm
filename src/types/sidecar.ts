export type SidecarHealth =
  | "stopped"
  | "bootstrapping"
  | "starting"
  | "healthy"
  | "failed";

export interface SidecarPorts {
  ollama: number;
  openai: number;
  native: number;
}

export interface SidecarStatus {
  health: SidecarHealth;
  ports: SidecarPorts;
  pid: number | null;
  message: string | null;
  healthy_apis: Array<"ollama" | "openai" | "native">;
  bootstrap_progress: string | null;
}
