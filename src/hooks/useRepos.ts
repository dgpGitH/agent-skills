import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export interface SkillRepo {
  id: string;
  name: string;
  description: string | null;
  repo_url: string;
  local_path: string;
  last_synced: string | null;
  skill_count: number;
}

export interface AddRepoResult {
  repo: SkillRepo;
  skills: import("@/hooks/useSkills").Skill[];
}

export function useRepos() {
  return useQuery<SkillRepo[]>({
    queryKey: ["repos"],
    queryFn: () => invoke("list_skill_repos"),
    staleTime: 60 * 1000,
  });
}

export function useAddRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repoUrl: string) =>
      invoke<AddRepoResult>("add_skill_repo", { repoUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useAddLocalDir() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      invoke<AddRepoResult>("add_local_dir", { path }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useRemoveRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      invoke("remove_skill_repo", { repoIdParam: repoId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

export function useSyncRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repoIdParam: string) =>
      invoke<SkillRepo>("sync_skill_repo", { repoIdParam }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      queryClient.invalidateQueries({ queryKey: ["repo-skills"] });
    },
  });
}

export function useRepoSkills(repoId: string | null) {
  return useQuery({
    queryKey: ["repo-skills", repoId],
    queryFn: () => invoke("list_repo_skills", { repoIdParam: repoId }),
    enabled: !!repoId,
    staleTime: 30 * 1000,
  });
}

export function useInstallRepoSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      repoIdParam,
      skillId,
      targetAgents,
    }: {
      repoIdParam: string;
      skillId: string;
      targetAgents: string[];
    }) => invoke("install_repo_skill", { repoIdParam, skillId, targetAgents }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
