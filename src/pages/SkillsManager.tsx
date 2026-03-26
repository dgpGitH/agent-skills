import { useState, useEffect, useMemo, useCallback, useTransition, useDeferredValue, memo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Puzzle,
  Copy,
  X,
  Loader2,
  Info,
  Pencil,
  ArrowLeft,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { AgentRow } from "@/components/AgentRow";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useSkills, installedAgents, allAgents, type Skill } from "@/hooks/useSkills";
import { useRepos } from "@/hooks/useRepos";

/** Skill extended with optional repo origin */
type SkillWithRepo = Skill & { _repoName?: string };
import { useAgents, type AgentConfig } from "@/hooks/useAgents";
import { useResizable } from "@/hooks/useResizable";
import ResizeHandle from "@/components/ResizeHandle";
import { Button } from "@/components/ui/button";
import SearchInput from "@/components/SearchInput";
import MarkdownContent from "@/components/MarkdownContent";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/utils";
import { extractMarkdownBody } from "@/lib/markdown";

export default function SkillsManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: skills, isLoading } = useSkills();
  const { data: agents } = useAgents();
  const { data: repos } = useRepos();

  // Fetch skills from all subscribed repos
  const repoSkillQueries = useQueries({
    queries: (repos ?? []).map((repo) => ({
      queryKey: ["repo-skills", repo.id],
      queryFn: () => invoke<Skill[]>("list_repo_skills", { repoIdParam: repo.id }),
      staleTime: 30 * 1000,
    })),
  });

  // Stable data reference for repo skills to avoid re-renders
  const repoSkillsData = repoSkillQueries.map((q) => q.data);

  // Merge local skills + repo skills (dedup by skill id, local wins)
  // For installed skills that match a repo skill, carry over the repo source info
  const mergedSkills = useMemo(() => {
    const localSkills = skills ?? [];
    const localById = new Map(localSkills.map((s) => [s.id, s]));

    // Build a map of repo skill source info by skill id
    const repoSourceById = new Map<string, { source: unknown; repoName: string }>();
    repoSkillsData.forEach((data, idx) => {
      if (data) {
        const repoName = repos?.[idx]?.name ?? "Repo";
        for (const s of data) {
          repoSourceById.set(s.id, { source: s.source, repoName });
        }
      }
    });

    // Enrich local skills with repo source info where available
    const enrichedLocal: SkillWithRepo[] = localSkills.map((s) => {
      const repoInfo = repoSourceById.get(s.id);
      if (repoInfo) {
        return { ...s, source: repoInfo.source, _repoName: repoInfo.repoName };
      }
      return s;
    });

    // Add repo-only skills (not installed locally)
    // Clear their virtual installations so they don't appear as "directly installed"
    const repoOnly: SkillWithRepo[] = [];
    repoSkillsData.forEach((data, idx) => {
      if (data) {
        const repoName = repos?.[idx]?.name ?? "Repo";
        for (const s of data) {
          if (!localById.has(s.id)) {
            repoOnly.push({ ...s, installations: [], _repoName: repoName });
          }
        }
      }
    });

    return [...enrichedLocal, ...repoOnly];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, ...repoSkillsData, repos]);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<string>(
    searchParams.get("agent") ?? "all"
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const isSearchStale = deferredSearch !== searchQuery;
  // selectedId drives list highlight (instant); selectedSkill drives detail (deferred)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isPending, startTransition] = useTransition();
  const [panelMode, setPanelMode] = useState<"detail" | "editor">("detail");
  const listPane = useResizable({
    initial: 300,
    min: 200,
    max: 500,
    storageKey: "skills-list-width",
  });

  // Sync filter from URL — reset selection so auto-select picks the first item
  useEffect(() => {
    const agentParam = searchParams.get("agent") ?? "all";
    setFilter(agentParam);
    setSelectedId(null);
    setSelectedSkill(null);
  }, [searchParams]);

  // Auto-select first skill when data loads or filter changes
  useEffect(() => {
    const list =
      filter === "all"
        ? mergedSkills
        : mergedSkills?.filter((s) => installedAgents(s).includes(filter));
    if (list?.length && !selectedId) {
      setSelectedId(list[0].id);
      setSelectedSkill(list[0]);
      setPanelMode("detail");
    }
  }, [mergedSkills, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeFilter(f: string) {
    setFilter(f);
    if (f === "all") {
      setSearchParams({});
    } else {
      setSearchParams({ agent: f });
    }
    // Reset selection so the auto-select effect picks the first item in the new list
    setSelectedId(null);
    setSelectedSkill(null);
  }

  const selectSkill = useCallback((skill: Skill) => {
    // Instant: update list highlight
    setSelectedId(skill.id);
    setPanelMode("detail");
    // Deferred: update detail panel without blocking the list
    startTransition(() => {
      setSelectedSkill(skill);
    });
  }, []);

  function closePanel() {
    setSelectedId(null);
    setSelectedSkill(null);
    setPanelMode("detail");
  }

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];

  // Filter by agent (direct + inherited), then by search query
  const filtered = useMemo(() => {
    // Only show skills that have at least one installation (direct or inherited)
    const available = mergedSkills?.filter((s) => allAgents(s).length > 0);
    let list = filter === "all"
      ? available
      : available?.filter((s) => allAgents(s).includes(filter));
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      list = list?.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q))
      );
    }
    return list;
  }, [mergedSkills, filter, deferredSearch]);

  async function refreshAndReselect() {
    // Force a fresh scan, bypassing cache
    const updated = await queryClient.fetchQuery<Skill[]>({
      queryKey: ["skills"],
      queryFn: () => invoke("scan_all_skills"),
      staleTime: 0,
    });
    // Also invalidate so other components pick up the change
    queryClient.setQueryData(["skills"], updated);
    if (selectedId) {
      const refreshed = updated?.find((s) => s.id === selectedId);
      setSelectedSkill(refreshed ?? null);
      if (!refreshed) setSelectedId(null);
    }
  }

  async function handleUninstall(skillId: string, agentSlug: string) {
    setBusy(skillId + agentSlug);
    try {
      await invoke("uninstall_skill", { skillId, agentSlug });
      await refreshAndReselect();
    } catch (e) {
      console.error("Uninstall failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.uninstallFailed"), "destructive");
    } finally {
      setBusy(null);
    }
  }

  async function handleUninstallAll(skill: Skill) {
    const slugs = installedAgents(skill);
    if (!slugs.length) return;
    setBusy(skill.id);
    try {
      await invoke("uninstall_skill_all", { skillId: skill.id });
      setSelectedId(null);
      setSelectedSkill(null);
      await refreshAndReselect();
    } catch (e) {
      console.error("Uninstall all failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.uninstallFailed"), "destructive");
    } finally {
      setBusy(null);
    }
  }

  async function handleSync(skillId: string, targetAgents: string[]) {
    setBusy(skillId);
    try {
      await invoke("sync_skill", { skillId, targetAgents });
      await refreshAndReselect();
    } catch (e) {
      console.error("Sync failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.syncFailed"), "destructive");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div
        className="shrink-0 overflow-y-auto p-4 space-y-3"
        style={{ width: listPane.width }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Puzzle className="size-4" />
            <h1 className="text-sm font-semibold">{t("skills.title")}</h1>
            {mergedSkills && (
              <span className="text-sm text-muted-foreground">
                ({filtered?.length})
              </span>
            )}
          </div>
        </div>

        {/* Agent filter */}
        <div className="flex gap-1.5 flex-wrap">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => changeFilter("all")}
          >
            {t("skills.filterAll")}
          </Button>
          {detectedAgents.map((agent) => (
            <Button
              key={agent.slug}
              variant={filter === agent.slug ? "default" : "outline"}
              size="sm"
              onClick={() => changeFilter(agent.slug)}
            >
              {agent.name}
            </Button>
          ))}
        </div>

        {/* Search */}
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t("skills.filterPlaceholder")}
          debounce={0}
        />

        {/* Skill list */}
        {isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-transparent px-3 py-2.5 space-y-2">
                <div className="h-4 w-28 rounded animate-skeleton" />
                <div className="h-3 w-40 rounded animate-skeleton" />
                <div className="flex gap-1">
                  <div className="h-4 w-12 rounded-full animate-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : !filtered?.length ? (
          <div className="rounded-2xl border border-dashed border-black/[0.06] dark:border-white/[0.06] p-8 text-center">
            <div className="inline-flex size-12 items-center justify-center rounded-xl glass mb-3">
              <Puzzle className="size-6 text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground">{t("skills.noSkillsFound")}</p>
          </div>
        ) : (
          <div
            className="space-y-1 transition-opacity"
            style={{ opacity: isSearchStale ? 0.5 : 1 }}
          >
            {filtered.map((skill) => (
              <SkillListItem
                key={skill.id}
                skill={skill}
                selected={selectedId === skill.id}
                agents={agents}
                onSelect={selectSkill}
                onReveal={revealItemInDir}
                onUninstallAll={handleUninstallAll}
              />
            ))}
          </div>
        )}
      </div>

      <ResizeHandle onMouseDown={listPane.onMouseDown} />

      {!selectedId && (
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-6">
          {filtered && filtered.length > 0 ? (
            <div className="text-center">
              <div className="inline-flex size-16 items-center justify-center rounded-2xl glass mb-4">
                <Puzzle className="size-8 text-primary/30" />
              </div>
              <p className="max-w-xs text-sm text-muted-foreground/80">
                {t("skills.selectToView")}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* Detail / Editor panel */}
      {selectedId && panelMode === "detail" && (
        isPending || !selectedSkill ? (
          <div className="flex-1 min-w-0 m-2 ml-0 rounded-2xl glass-panel flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <SkillDetail
            skill={selectedSkill}
            detectedAgents={detectedAgents}
            busy={busy}
            onClose={closePanel}
            onEdit={() => setPanelMode("editor")}
            onSync={handleSync}
            onUninstall={handleUninstall}
          />
        )
      )}
      {selectedSkill && panelMode === "editor" && (
        <SkillEditor
          skill={selectedSkill}
          onClose={closePanel}
          onBack={() => setPanelMode("detail")}
        />
      )}
    </div>
  );
}

const SkillListItem = memo(function SkillListItem({
  skill,
  selected,
  agents,
  onSelect,
  onReveal,
  onUninstallAll,
}: {
  skill: SkillWithRepo;
  selected: boolean;
  agents: import("@/hooks/useAgents").AgentConfig[] | undefined;
  onSelect: (skill: SkillWithRepo) => void;
  onReveal: (path: string) => void;
  onUninstallAll: (skill: SkillWithRepo) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const directSlugs = installedAgents(skill);
  const inheritedSlugs = skill.installations
    .filter((i) => i.is_inherited)
    .map((i) => i.agent_slug)
    .filter((s) => !directSlugs.includes(s));
  const hasDirectInstall = directSlugs.length > 0;
  const inheritedOnly = !hasDirectInstall && inheritedSlugs.length > 0;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const raf = requestAnimationFrame(() => {
      document.addEventListener("click", close);
      document.addEventListener("contextmenu", close);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  return (
    <div className="relative">
      <button
        type="button"
        className={cn(
          "w-full rounded-xl px-3 py-2.5 text-left transition-all duration-200 select-none",
          selected
            ? "glass glass-shine-always"
            : "border border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
          inheritedOnly && "opacity-60",
        )}
        onClick={() => onSelect(skill)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <h3 className="text-sm font-medium truncate">{skill.name}</h3>
        {skill.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {skill.description}
          </p>
        )}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {directSlugs.map((slug) => (
            <span
              key={slug}
              className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
            >
              {agents?.find((a) => a.slug === slug)?.name ?? slug}
            </span>
          ))}
          {inheritedSlugs.map((slug) => (
            <span
              key={slug}
              className="rounded-full border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {agents?.find((a) => a.slug === slug)?.name ?? slug}
            </span>
          ))}
        </div>
      </button>

      {menu && (
        <div
          className="fixed z-50 w-[180px] rounded-xl glass-elevated p-1 shadow-lg animate-fade-in-up"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors"
            onClick={() => {
              onReveal(skill.canonical_path);
              setMenu(null);
            }}
          >
            {t("skills.revealInFinder")}
          </button>
          {hasDirectInstall && (
            <button
              className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
              onClick={() => {
                onUninstallAll(skill);
                setMenu(null);
              }}
            >
              {t("skills.uninstallAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

function repoSlugFromUrl(url: string): string | null {
  // "https://github.com/MiniMax-AI/skills.git" → "MiniMax-AI/skills"
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "");
  const parts = cleaned.split("/");
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return null;
}

function getSourceLabel(source: unknown, t: (key: string) => string): string {
  if (!source) return t("skills.sourceUnknown");
  if (typeof source === "string") return source === "Unknown" ? t("skills.sourceUnknown") : source;
  if (typeof source !== "object") return t("skills.sourceUnknown");
  const src = source as Record<string, unknown>;
  if ("LocalPath" in src) return t("skills.sourceLocalPath");
  if ("GitRepository" in src) {
    const git = src["GitRepository"] as Record<string, unknown>;
    const slug = typeof git.repo_url === "string" ? repoSlugFromUrl(git.repo_url) : null;
    return slug ?? t("skills.sourceGit");
  }
  if ("SkillsSh" in src) return t("skills.sourceSkillsSh");
  if ("ClawHub" in src) return t("skills.sourceClawHub");
  return t("skills.sourceUnknown");
}

function getSourceRepo(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const src = source as Record<string, unknown>;
  if ("GitRepository" in src) {
    const git = src["GitRepository"] as Record<string, unknown>;
    return (git.repo_url as string) ?? null;
  }
  if ("SkillsSh" in src) {
    const s = src["SkillsSh"] as Record<string, unknown>;
    return (s.repository as string) ?? null;
  }
  if ("ClawHub" in src) {
    const c = src["ClawHub"] as Record<string, unknown>;
    return (c.repository as string) ?? null;
  }
  return null;
}

function SkillDetail({
  skill,
  detectedAgents,
  busy,
  onClose,
  onEdit,
  onSync,
  onUninstall,
}: {
  skill: Skill;
  detectedAgents: AgentConfig[];
  busy: string | null;
  onClose: () => void;
  onEdit: () => void;
  onSync: (skillId: string, targetAgents: string[]) => void;
  onUninstall: (skillId: string, agentSlug: string) => void;
}) {
  const { t } = useTranslation();
  const syncTargets = detectedAgents.filter(
    (a) => !installedAgents(skill).includes(a.slug)
  );
  const sourceLabel = getSourceLabel(skill.source, t);
  const sourceRepo = getSourceRepo(skill.source);
  const metadata = skill.metadata as Record<string, unknown> | null;

  // Defer the heavy markdown rendering so the panel paints instantly
  const deferredSkillPath = useDeferredValue(skill.canonical_path);
  const isStale = deferredSkillPath !== skill.canonical_path;

  // Load SKILL.md content — try local first, fall back to remote if empty
  const skillMdPath = deferredSkillPath.endsWith("SKILL.md")
    ? deferredSkillPath
    : deferredSkillPath + "/SKILL.md";
  const { data: docContent, isLoading: docLoading } = useQuery<string | null>({
    queryKey: ["skill-content", skillMdPath, sourceRepo],
    queryFn: async () => {
      // Try local SKILL.md first
      try {
        const text = await invoke<string>("read_skill_content", { path: skillMdPath });
        const body = extractMarkdownBody(text);
        if (body && body.trim().length > 0) return body;
      } catch { /* local read failed, fall through */ }
      // Fallback: fetch from remote repository if source info is available
      if (sourceRepo) {
        try {
          const text = await invoke<string>("fetch_remote_skill_content", {
            repoUrl: sourceRepo,
            skillName: skill.id,
          });
          return extractMarkdownBody(text);
        } catch { /* remote also unavailable */ }
      }
      return null;
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  return (
    <div className="flex-1 min-w-0 m-2 ml-0 rounded-2xl glass-panel flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Info className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="text-sm font-medium truncate">{t("skills.detail")}</h3>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Header: Name & Description */}
        <div>
          <h2 className="text-base font-semibold leading-tight">
            {skill.name}
          </h2>
          {skill.description && (
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {skill.description}
            </p>
          )}
          <button
            className="text-xs text-muted-foreground/60 hover:text-primary font-mono mt-1.5 break-all text-left transition-colors cursor-pointer"
            title={t("skills.revealInFinder")}
            onClick={() => revealItemInDir(skill.canonical_path)}
          >
            {skill.canonical_path}
          </button>
        </div>

        <hr className="border-border" />

        {/* Package Info — grid layout */}
        <DetailSection label={t("skills.packageInfo")}>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
            <span className="text-xs text-muted-foreground">{t("skills.sourceLabel")}</span>
            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium w-fit">
              {sourceLabel}
            </span>
            {sourceRepo && (
              <>
                <span className="text-xs text-muted-foreground">{t("skills.repository")}</span>
                <button
                  className="text-xs font-mono break-all text-left text-primary hover:underline cursor-pointer"
                  onClick={() => openUrl(sourceRepo!)}
                >
                  {sourceRepo}
                </button>
              </>
            )}
            <span className="text-xs text-muted-foreground">{t("skills.scope")}</span>
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium w-fit ${
              skill.scope.type === "SharedGlobal"
                ? "bg-blue-500/15 text-blue-600"
                : "bg-muted text-muted-foreground"
            }`}>
              {skill.scope.type === "SharedGlobal"
                ? t("skills.scopeGlobal")
                : t("skills.scopeLocal", { name: detectedAgents.find((a) => a.slug === (skill.scope as { agent: string }).agent)?.name ?? "Local" })}
            </span>
          </div>
        </DetailSection>

        {/* Skill Metadata */}
        {metadata && Object.keys(metadata).length > 0 && (
          <>
            <hr className="border-border" />
            <DetailSection label={t("skills.skillMetadata")}>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
                {Object.entries(metadata).map(([key, value]) => (
                  <Fragment key={key}>
                    <span className="text-xs text-muted-foreground capitalize">
                      {key}
                    </span>
                    <span className="text-xs break-all">
                      {typeof value === "string"
                        ? value
                        : JSON.stringify(value)}
                    </span>
                  </Fragment>
                ))}
              </div>
            </DetailSection>
          </>
        )}

        <hr className="border-border" />

        {/* Agent Assignment */}
        <DetailSection label={t("skills.agentsLabel", { installed: installedAgents(skill).length, total: detectedAgents.length })}>
          <div className="space-y-1.5">
            {detectedAgents.map((agent) => {
              const inst = skill.installations.find(
                (i) => i.agent_slug === agent.slug && !i.is_inherited
              );
              const inheritedInst = skill.installations.find(
                (i) => i.agent_slug === agent.slug && i.is_inherited
              );
              const installation = inst ?? inheritedInst;
              const installed = !!inst;
              const inherited = !inst && !!inheritedInst;
              return (
                <AgentRow
                  key={agent.slug}
                  name={agent.name}
                  status={installed ? "installed" : inherited ? "inherited" : "not-installed"}
                  path={installation?.path}
                  tags={inherited && inheritedInst?.inherited_from ? (
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                      {t("skills.via", { name: detectedAgents.find((a) => a.slug === inheritedInst.inherited_from)?.name ?? inheritedInst.inherited_from })}
                    </span>
                  ) : undefined}
                  onUninstall={() => onUninstall(skill.id, agent.slug)}
                  onInstall={() => onSync(skill.id, [agent.slug])}
                  uninstallTitle={`${t("skills.uninstall")} ${agent.name}`}
                  installLabel={t("skills.sync")}
                  installTitle={`${t("skills.sync")} → ${agent.name}`}
                  revealTitle={t("skills.revealInFinder")}
                  disabled={busy === skill.id + agent.slug}
                />
              );
            })}
          </div>
        </DetailSection>

        <hr className="border-border" />

        {/* Actions */}
        <DetailSection label={t("skills.actions")}>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
              {t("skills.editSkillMd")}
            </Button>
            {syncTargets.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                disabled={busy === skill.id}
                onClick={() =>
                  onSync(
                    skill.id,
                    syncTargets.map((a) => a.slug)
                  )
                }
              >
                <Copy className="size-3.5" />
                {t("skills.syncTo", { names: syncTargets.map((a) => a.name).join(", ") })}
              </Button>
            )}
          </div>
        </DetailSection>

        <hr className="border-border" />

        {/* Documentation — deferred so detail panel renders first */}
        <DetailSection label={t("skills.skillContent")}>
          {isStale || docLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("skills.loading")}
            </div>
          ) : docContent ? (
            <MarkdownContent content={docContent} />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {t("skills.noContent")}
            </p>
          )}
        </DetailSection>
      </div>
    </div>
  );
}

function DetailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </p>
      {children}
    </div>
  );
}

function SkillEditor({
  skill,
  onClose,
  onBack,
}: {
  skill: Skill;
  onClose: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLoading(true);
    setDirty(false);
    const skillMdPath = skill.canonical_path.endsWith("SKILL.md")
      ? skill.canonical_path
      : skill.canonical_path + "/SKILL.md";
    invoke<string>("read_skill_content", { path: skillMdPath })
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch(() => {
        setContent(t("skills.failedToLoad"));
        setLoading(false);
      });
  }, [skill.canonical_path, t]);

  async function handleSave() {
    setSaving(true);
    const skillMdPath = skill.canonical_path.endsWith("SKILL.md")
      ? skill.canonical_path
      : skill.canonical_path + "/SKILL.md";
    try {
      await invoke("write_skill_content", { path: skillMdPath, content });
      setDirty(false);
    } catch (e) {
      console.error("Save failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.saveFailed"), "destructive");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 min-w-0 m-2 ml-0 rounded-2xl glass-panel flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 px-2"
            onClick={onBack}
            title={t("skills.backToDetail")}
          >
            <ArrowLeft className="size-3.5" />
            {t("skills.backToDetail")}
          </Button>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium truncate">{skill.name}</h3>
            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
              SKILL.md
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-2">
          {dirty && (
            <Button
              variant="default"
              size="xs"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                t("skills.save")
              )}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Editor */}
      {loading ? (
        <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          {t("skills.loading")}
        </div>
      ) : (
        <textarea
          className="flex-1 resize-none bg-transparent px-4 py-3 text-sm font-mono leading-relaxed outline-none placeholder:text-muted-foreground"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
        />
      )}
    </div>
  );
}
