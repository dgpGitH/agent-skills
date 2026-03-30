import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, GitBranch, FolderOpen, Check, Puzzle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAddRepo, useAddLocalDir, useRemoveRepo, type SkillRepo, type AddRepoResult } from "@/hooks/useRepos";
import { useAgents, type AgentConfig } from "@/hooks/useAgents";
import { type Skill } from "@/hooks/useSkills";
import { getAgentIcon } from "@/lib/agentIcons";

type WizardStep = "source" | "indexing" | "skills" | "agents" | "installing";

interface ImportWizardProps {
  mode: "git" | "local";
  initialLocalPath?: string | null;
  onClose: () => void;
}

interface RepoProgress {
  stage: string;
}

const INDEX_STAGE_KEYS: Record<string, string> = {
  cloning: "repos.cloning",
  scanning: "repos.scanning",
  saving: "repos.savingConfig",
};

export default function ImportWizard({ mode, initialLocalPath, onClose }: ImportWizardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);

  // Step state
  const [step, setStep] = useState<WizardStep>("source");
  const busy = step === "indexing" || step === "installing";

  // Source step
  const [url, setUrl] = useState("");
  const [localPath, setLocalPath] = useState<string | null>(initialLocalPath ?? null);

  // Indexing step
  const addRepo = useAddRepo();
  const addLocalDir = useAddLocalDir();
  const removeRepo = useRemoveRepo();
  const installedRef = useRef(false);
  const [indexStage, setIndexStage] = useState<string | null>(null);
  const [repo, setRepo] = useState<SkillRepo | null>(null);

  // Skills step
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());

  // Agents step
  const { data: allAgents } = useAgents();
  const detectedAgents = allAgents?.filter((a) => a.detected) ?? [];
  const [selectedAgentSlugs, setSelectedAgentSlugs] = useState<Set<string>>(new Set());

  // Installing step
  const [installDone, setInstallDone] = useState(0);
  const [installTotal, setInstallTotal] = useState(0);
  const [currentSkill, setCurrentSkill] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Clean up the repo if the wizard is closed without installing any skills
  const handleClose = useCallback(() => {
    if (repo && !installedRef.current) {
      removeRepo.mutate(repo.id);
    }
    onClose();
  }, [repo, onClose, removeRepo]);

  // Focus panel on mount
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Escape to close (when not busy)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) handleClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleClose, busy]);

  // Listen for backend progress events during indexing
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<RepoProgress>("repo-progress", (event) => {
      setIndexStage(event.payload.stage);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => { unlisten?.(); };
  }, []);

  // Auto-start indexing when opened with a pre-selected local path
  useEffect(() => {
    if (mode === "local" && initialLocalPath && step === "source") {
      startIndexing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setLocalPath(selected);
    } else {
      // User cancelled folder picker
      handleClose();
    }
  }

  // Start cloning/indexing
  async function startIndexing() {
    setStep("indexing");
    setIndexStage(null);
    setError(null);

    try {
      let result: AddRepoResult;
      if (mode === "git") {
        result = await addRepo.mutateAsync(url.trim());
      } else {
        result = await addLocalDir.mutateAsync(localPath!);
      }
      setRepo(result.repo);
      setSkills(result.skills);
      setSelectedSkillIds(new Set(result.skills.map((s) => s.id)));

      // Auto-select all detected agents
      const detected = allAgents?.filter((a) => a.detected) ?? [];
      setSelectedAgentSlugs(new Set(detected.map((a) => a.slug)));

      setStep("skills");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("source");
      setIndexStage(null);
    }
  }

  // Batch install
  async function runBatchInstall() {
    if (!repo) return;
    const skillIds = Array.from(selectedSkillIds);
    const agentSlugs = Array.from(selectedAgentSlugs);
    const total = skillIds.length;

    setStep("installing");
    setInstallDone(0);
    setInstallTotal(total);

    for (let i = 0; i < skillIds.length; i++) {
      const skillId = skillIds[i];
      const skill = skills.find((s) => s.id === skillId);
      setCurrentSkill(skill?.name ?? skillId);
      setInstallDone(i);
      try {
        await invoke("install_repo_skill", {
          repoIdParam: repo.id,
          skillId,
          targetAgents: agentSlugs,
        });
      } catch (e) {
        console.error(`Failed to install ${skillId}:`, e);
      }
    }

    setInstallDone(total);
    setCurrentSkill(null);
    installedRef.current = true;

    // Invalidate caches
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await queryClient.invalidateQueries({ queryKey: ["repos"] });
    await queryClient.invalidateQueries({ queryKey: ["repo-skills"] });

    onClose();
  }

  // Checkbox helpers
  const toggleSkill = useCallback((id: string) => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAllSkills = useCallback(() => {
    setSelectedSkillIds((prev) =>
      prev.size === skills.length ? new Set() : new Set(skills.map((s) => s.id))
    );
  }, [skills]);

  const toggleAgent = useCallback((slug: string) => {
    setSelectedAgentSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  }, []);

  const toggleAllAgents = useCallback(() => {
    setSelectedAgentSlugs((prev) =>
      prev.size === detectedAgents.length
        ? new Set()
        : new Set(detectedAgents.map((a) => a.slug))
    );
  }, [detectedAgents]);

  // Step indicators
  const stepKeys: WizardStep[] = ["source", "indexing", "skills", "agents"];
  const stepIdx = stepKeys.indexOf(step === "installing" ? "agents" : step);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 dark:bg-black/40 animate-backdrop-in"
      role="presentation"
      onClick={busy ? undefined : handleClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-3xl p-6 space-y-4 outline-none animate-modal-in glass-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === "git" ? (
              <GitBranch className="size-4" />
            ) : (
              <FolderOpen className="size-4" />
            )}
            <h2 className="text-sm font-semibold">
              {mode === "git" ? t("repos.importRepo") : t("repos.importLocal")}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {/* Step dots */}
            <div className="flex items-center gap-1.5">
              {stepKeys.map((_, i) => (
                <div
                  key={i}
                  className={`size-1.5 rounded-full transition-colors ${
                    i <= stepIdx ? "bg-primary" : "bg-muted-foreground/20"
                  }`}
                />
              ))}
            </div>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
              onClick={handleClose}
              disabled={busy}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Step: Source */}
        {step === "source" && mode === "git" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) startIndexing();
            }}
            className="space-y-3"
          >
            <p className="text-xs text-muted-foreground">
              {t("repos.importDescription")}
            </p>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/user/skills-repo.git"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" type="button" onClick={handleClose}>
                {t("repos.cancel")}
              </Button>
              <Button size="sm" type="submit" disabled={!url.trim()}>
                {t("repos.add")}
              </Button>
            </div>
          </form>
        )}

        {step === "source" && mode === "local" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("repos.importLocalDescription")}
            </p>
            {localPath ? (
              <>
                <div className="rounded-md glass-inset px-3 py-2 text-xs font-mono break-all">
                  {localPath}
                </div>
                {error && (
                  <p className="text-xs text-destructive">{error}</p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={pickFolder}>
                    {t("repos.selectFolder")}
                  </Button>
                  <Button size="sm" onClick={startIndexing}>
                    {t("repos.add")}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={handleClose}>
                  {t("repos.cancel")}
                </Button>
                <Button size="sm" onClick={pickFolder}>
                  {t("repos.selectFolder")}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step: Indexing */}
        {step === "indexing" && (
          <IndexingProgress
            mode={mode}
            indexStage={indexStage}
          />
        )}

        {/* Step: Select Skills */}
        {step === "skills" && (
          <div className="space-y-3">
            {skills.length === 0 ? (
              <div className="py-8 text-center">
                <Puzzle className="size-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">
                  {t("repos.noSkillsFound")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={handleClose}
                >
                  {t("repos.cancel")}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {t("repos.skillsFound", { count: skills.length })}
                  </p>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline cursor-pointer"
                    onClick={toggleAllSkills}
                  >
                    {selectedSkillIds.size === skills.length
                      ? t("repos.deselectAll")
                      : t("repos.selectAll")}
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-0.5 -mx-1 px-1">
                  {skills.map((skill) => (
                    <SkillCheckItem
                      key={skill.id}
                      skill={skill}
                      checked={selectedSkillIds.has(skill.id)}
                      onToggle={toggleSkill}
                    />
                  ))}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={handleClose}>
                    {t("repos.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={selectedSkillIds.size === 0}
                    onClick={() => setStep("agents")}
                  >
                    {t("repos.next", { count: selectedSkillIds.size })}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step: Select Agents */}
        {step === "agents" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("repos.selectAgents")}
            </p>
            {detectedAgents.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-xs text-muted-foreground">
                  {t("repos.noAgentsDetected")}
                </p>
              </div>
            ) : (
              <>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline cursor-pointer"
                    onClick={toggleAllAgents}
                  >
                    {selectedAgentSlugs.size === detectedAgents.length
                      ? t("repos.deselectAll")
                      : t("repos.selectAll")}
                  </button>
                </div>
                <div className="space-y-0.5">
                  {detectedAgents.map((agent) => (
                    <AgentCheckItem
                      key={agent.slug}
                      agent={agent}
                      checked={selectedAgentSlugs.has(agent.slug)}
                      onToggle={toggleAgent}
                    />
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("skills")}
              >
                {t("repos.back")}
              </Button>
              <Button
                size="sm"
                disabled={selectedAgentSlugs.size === 0}
                onClick={runBatchInstall}
              >
                {t("repos.installCount", { count: selectedSkillIds.size })}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Installing */}
        {step === "installing" && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin text-primary" />
              {t("repos.installingProgress", {
                done: installDone,
                total: installTotal,
              })}
            </div>
            {currentSkill && (
              <p className="text-xs text-muted-foreground">
                {t("repos.installingSkill", { name: currentSkill })}
              </p>
            )}
            {/* Progress bar */}
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{
                  width: `${installTotal > 0 ? (installDone / installTotal) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───

function IndexingProgress({ mode, indexStage }: { mode: "git" | "local"; indexStage: string | null }) {
  const { t } = useTranslation();
  const stages: string[] = mode === "git" ? ["cloning", "scanning", "saving"] : ["scanning"];
  const currentIdx = indexStage ? stages.indexOf(indexStage) : 0;

  return (
    <div className="space-y-2 py-2">
      {stages.map((s, idx) => {
        const isActive = idx === currentIdx;
        const isDone = idx < currentIdx || indexStage === "done";
        return (
          <div
            key={s}
            className={`flex items-center gap-2 text-xs transition-opacity ${
              isActive
                ? "text-foreground"
                : isDone
                  ? "text-muted-foreground"
                  : "text-muted-foreground/40"
            }`}
          >
            {isDone ? (
              <Check className="size-3 text-green-500" />
            ) : isActive ? (
              <Loader2 className="size-3 animate-spin text-primary" />
            ) : (
              <div className="size-3 rounded-full border border-current opacity-30" />
            )}
            {t(INDEX_STAGE_KEYS[s] ?? s)}
          </div>
        );
      })}
    </div>
  );
}

const SkillCheckItem = memo(function SkillCheckItem({
  skill,
  checked,
  onToggle,
}: {
  skill: Skill;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(skill.id)}
        className="mt-0.5 size-3.5 rounded accent-primary"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight truncate">{skill.name}</p>
        {skill.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {skill.description}
          </p>
        )}
      </div>
    </label>
  );
});

const AgentCheckItem = memo(function AgentCheckItem({
  agent,
  checked,
  onToggle,
}: {
  agent: AgentConfig;
  checked: boolean;
  onToggle: (slug: string) => void;
}) {
  const icon = getAgentIcon(agent.slug);
  return (
    <label className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(agent.slug)}
        className="size-3.5 rounded accent-primary"
      />
      {icon.type === "component" ? (
        <icon.Component className="size-4 rounded-[3px]" />
      ) : (
        <img src={icon.src} alt="" className="size-4 rounded-[3px]" />
      )}
      <span className="text-sm font-medium">{agent.name}</span>
    </label>
  );
});
