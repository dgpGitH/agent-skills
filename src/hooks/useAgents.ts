import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export interface AgentConfig {
  slug: string;
  name: string;
  enabled: boolean;
  global_paths: string[];
  skill_format: string;
  cli_command: string | null;
  install_command: string | null;
  install_command_windows: string | null;
  install_docs_url: string | null;
  install_source_label: string | null;
  detected: boolean;
}

/** Get the platform-appropriate install command */
export function getInstallCommand(agent: AgentConfig): string | null {
  if (navigator.userAgent.includes("Windows")) {
    return agent.install_command_windows ?? agent.install_command;
  }
  return agent.install_command;
}

export function useAgents() {
  return useQuery<AgentConfig[]>({
    queryKey: ["agents"],
    queryFn: () => invoke("detect_agents"),
    staleTime: 5 * 60 * 1000, // agent detection rarely changes
  });
}

export function useAllAgents() {
  return useQuery<AgentConfig[]>({
    queryKey: ["all-agents"],
    queryFn: () => invoke("list_agents"),
    staleTime: 5 * 60 * 1000,
  });
}
