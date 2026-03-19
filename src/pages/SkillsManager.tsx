import { useState, useEffect, useMemo, useCallback, useTransition, useDeferredValue, memo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Puzzle,
  Trash2,
  Copy,
  X,
  Loader2,
  Info,
  Pencil,
  ArrowLeft,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSkills, installedAgents, type Skill } from "@/hooks/useSkills";
import { useAgents, type AgentConfig } from "@/hooks/useAgents";
import { useResizable } from "@/hooks/useResizable";
import ResizeHandle from "@/components/ResizeHandle";
import { Button } from "@/components/ui/button";
import SearchInput from "@/components/SearchInput";
import MarkdownContent from "@/components/MarkdownContent";

export default function SkillsManager() {
  const { t } = useTranslation();
  const { data: skills, isLoading } = useSkills();
  const { data: agents } = useAgents();
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

  // Sync filter from URL
  useEffect(() => {
    const agentParam = searchParams.get("agent");
    if (agentParam) setFilter(agentParam);
  }, [searchParams]);

  // Auto-select first skill when data loads or filter changes
  useEffect(() => {
    const list =
      filter === "all"
        ? skills
        : skills?.filter((s) => installedAgents(s).includes(filter));
    if (list?.length && !selectedId) {
      setSelectedId(list[0].id);
      setSelectedSkill(list[0]);
      setPanelMode("detail");
    }
  }, [skills, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeFilter(f: string) {
    setFilter(f);
    if (f === "all") {
      setSearchParams({});
    } else {
      setSearchParams({ agent: f });
    }
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

  // Filter by agent, then by deferred search query (name + description)
  const filtered = useMemo(() => {
    let list = filter === "all"
      ? skills
      : skills?.filter((s) => installedAgents(s).includes(filter));
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
  }, [skills, filter, deferredSearch]);

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

  async function handleUninstall(skillPath: string, agentSlug: string) {
    setBusy(skillPath + agentSlug);
    try {
      await invoke("uninstall_skill", { skillId: skillPath, agentSlug });
      await refreshAndReselect();
    } catch (e) {
      console.error("Uninstall failed:", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleSync(skillPath: string, targetAgents: string[]) {
    setBusy(skillPath);
    try {
      await invoke("sync_skill", { skillId: skillPath, targetAgents });
      await refreshAndReselect();
    } catch (e) {
      console.error("Sync failed:", e instanceof Error ? e.message : String(e));
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
            {skills && (
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
          <p className="text-sm text-muted-foreground">{t("skills.scanningSkills")}</p>
        ) : !filtered?.length ? (
          <p className="text-sm text-muted-foreground">{t("skills.noSkillsFound")}</p>
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
              />
            ))}
          </div>
        )}
      </div>

      <ResizeHandle onMouseDown={listPane.onMouseDown} />

      {/* Detail / Editor panel */}
      {selectedId && panelMode === "detail" && (
        isPending || !selectedSkill ? (
          <div className="flex-1 min-w-0 bg-card flex items-center justify-center">
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
}: {
  skill: Skill;
  selected: boolean;
  agents: import("@/hooks/useAgents").AgentConfig[] | undefined;
  onSelect: (skill: Skill) => void;
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2.5 transition-colors cursor-pointer hover:bg-accent/50 ${
        selected ? "border-primary bg-accent/30" : "border-transparent"
      }`}
      onClick={() => onSelect(skill)}
    >
      <h3 className="text-sm font-medium truncate">{skill.name}</h3>
      {skill.description && (
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
          {skill.description}
        </p>
      )}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {installedAgents(skill).map((slug) => (
          <span
            key={slug}
            className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
          >
            {agents?.find((a) => a.slug === slug)?.name ?? slug}
          </span>
        ))}
      </div>
    </div>
  );
});

function getSourceLabel(source: unknown, t: (key: string) => string): string {
  if (!source) return t("skills.sourceUnknown");
  if (typeof source === "string") return source === "Unknown" ? t("skills.sourceUnknown") : source;
  if (typeof source !== "object") return t("skills.sourceUnknown");
  const src = source as Record<string, unknown>;
  if ("LocalPath" in src) return t("skills.sourceLocalPath");
  if ("GitRepository" in src) return t("skills.sourceGit");
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
  onSync: (skillPath: string, targetAgents: string[]) => void;
  onUninstall: (skillPath: string, agentSlug: string) => void;
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

  // Load SKILL.md content — cached by path so switching back is instant
  const skillMdPath = deferredSkillPath.endsWith("SKILL.md")
    ? deferredSkillPath
    : deferredSkillPath + "/SKILL.md";
  const { data: docContent, isLoading: docLoading } = useQuery<string | null>({
    queryKey: ["skill-content-local", skillMdPath],
    queryFn: async () => {
      const text = await invoke<string>("read_skill_content", { path: skillMdPath });
      return extractMarkdownBody(text);
    },
    staleTime: 60 * 1000, // local file, cache 1 min
    retry: false,
  });

  return (
    <div className="flex-1 min-w-0 bg-card flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Info className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="text-sm font-medium truncate">{t("skills.detail")}</h3>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-5">
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
                <p className="text-xs font-mono break-all">{sourceRepo}</p>
              </>
            )}
            <span className="text-xs text-muted-foreground">{t("skills.id")}</span>
            <p className="text-xs font-mono break-all">{skill.id}</p>
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
                <div
                  key={agent.slug}
                  className={`rounded-md px-2.5 py-2 text-xs ${
                    installed
                      ? "bg-secondary/60"
                      : inherited
                        ? "bg-secondary/30"
                        : "bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`size-1.5 rounded-full shrink-0 ${
                          installed
                            ? "bg-green-500"
                            : inherited
                              ? "bg-blue-400"
                              : "bg-muted-foreground/30"
                        }`}
                      />
                      <span
                        className={
                          installed || inherited
                            ? "font-medium truncate"
                            : "text-muted-foreground truncate"
                        }
                      >
                        {agent.name}
                      </span>
                      {inherited && inheritedInst?.inherited_from && (
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">
                          {t("skills.via", { name: detectedAgents.find((a) => a.slug === inheritedInst.inherited_from)?.name ?? inheritedInst.inherited_from })}
                        </span>
                      )}
                      {inst?.is_symlink && (
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">
                          {t("skills.symlink")}
                        </span>
                      )}
                    </div>
                    {installed ? (
                      <button
                        className="text-destructive/60 hover:text-destructive transition-colors disabled:opacity-50 shrink-0"
                        title={`${t("skills.uninstall")} ${agent.name}`}
                        disabled={busy === skill.canonical_path + agent.slug}
                        onClick={() => onUninstall(skill.canonical_path, agent.slug)}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    ) : !inherited ? (
                      <Button
                        variant="outline"
                        size="xs"
                        className="shrink-0 h-5 px-2 text-[10px]"
                        title={`${t("skills.install")} ${agent.name}`}
                        disabled={busy === skill.canonical_path + agent.slug}
                        onClick={() =>
                          onSync(skill.canonical_path, [agent.slug])
                        }
                      >
                        <Copy className="size-2.5" />
                        {t("skills.install")}
                      </Button>
                    ) : null}
                  </div>
                  {installation?.path && (
                    <button
                      className="text-[10px] text-muted-foreground/70 hover:text-primary font-mono mt-1 pl-[18px] break-all text-left leading-relaxed transition-colors cursor-pointer"
                      title={t("skills.revealInFinder")}
                      onClick={() => revealItemInDir(installation.path)}
                    >
                      {installation.path}
                    </button>
                  )}
                </div>
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
                disabled={busy === skill.canonical_path}
                onClick={() =>
                  onSync(
                    skill.canonical_path,
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

/** Extract markdown body after YAML frontmatter */
function extractMarkdownBody(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return trimmed;
  const end = trimmed.indexOf("---", 3);
  if (end === -1) return trimmed;
  return trimmed.slice(end + 3).trim();
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 min-w-0 bg-card flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            title={t("skills.backToDetail")}
          >
            <ArrowLeft className="size-4" />
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
