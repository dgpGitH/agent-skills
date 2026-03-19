import { useState, useEffect, useCallback, useDeferredValue, useMemo, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  Store,
  Download,
  Loader2,
  X,
  ExternalLink,
  User,
  Tag,
  Check,
  Copy,
  Trash2,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAgents, type AgentConfig } from "@/hooks/useAgents";
import { useSkills, installedAgents as getInstalledAgents, type Skill } from "@/hooks/useSkills";
import MarkdownContent from "@/components/MarkdownContent";
import { useResizable } from "@/hooks/useResizable";
import ResizeHandle from "@/components/ResizeHandle";
import SearchInput from "@/components/SearchInput";
import { Button } from "@/components/ui/button";

interface MarketplaceSkill {
  name: string;
  description: string | null;
  author: string | null;
  repository: string | null;
  installs: number | null;
  source: string;
}

const SOURCES = [
  { key: "skills.sh", label: "skills.sh" },
  { key: "clawhub", label: "ClawHub" },
];

export default function Marketplace() {
  const { t } = useTranslation();
  const [source, setSource] = useState("skills.sh");
  const [skillsshSort, setSkillsshSort] = useState("all-time");
  const [clawhubSort, setClawhubSort] = useState("default");
  const [searchQuery, setSearchQuery] = useState("");
  // Track which agent slugs are currently being installed
  const [installingAgents, setInstallingAgents] = useState<Set<string>>(new Set());
  // selectedKey drives list highlight (instant); detail uses deferred key
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { data: agents } = useAgents();
  const { data: localSkills } = useSkills();
  const queryClient = useQueryClient();
  const listPane = useResizable({
    initial: 340,
    min: 240,
    max: 560,
    storageKey: "marketplace-list-width",
  });

  // Sort options with translations
  const SKILLSSH_SORTS = useMemo(() => [
    { key: "all-time", label: t("marketplace.sortAllTime") },
    { key: "trending", label: t("marketplace.sortTrending") },
    { key: "hot", label: t("marketplace.sortHot") },
  ], [t]);

  const CLAWHUB_SORTS = useMemo(() => [
    { key: "default", label: t("marketplace.sortDefault") },
    { key: "downloads", label: t("marketplace.sortDownloads") },
    { key: "stars", label: t("marketplace.sortStars") },
  ], [t]);

  // SearchInput fires debounced changes; we store the query for React Query
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];
  const currentSort = source === "skills.sh" ? skillsshSort : clawhubSort;
  const sorts = source === "skills.sh" ? SKILLSSH_SORTS : CLAWHUB_SORTS;
  const setSort = source === "skills.sh" ? setSkillsshSort : setClawhubSort;
  const deferredSelectedKey = useDeferredValue(selectedKey);

  const {
    data: items,
    isLoading,
    error,
  } = useQuery<MarketplaceSkill[]>({
    queryKey: ["marketplace", source, currentSort, searchQuery],
    queryFn: async () => {
      if (searchQuery.trim()) {
        return invoke("search_marketplace", {
          query: searchQuery.trim(),
          source,
        });
      }
      if (source === "skills.sh") {
        return invoke("fetch_skillssh", { sort: currentSort, page: 1 });
      }
      return invoke("fetch_clawhub", {
        endpoint: currentSort,
        params: {},
      });
    },
    staleTime: 5 * 60 * 1000, // backend has 5-min SQLite cache; avoid redundant IPC
  });

  // Auto-select first item when data loads
  useEffect(() => {
    if (items?.length && !selectedKey) {
      const first = items[0];
      setSelectedKey(skillKey(first));
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSkill = useMemo(() => {
    if (!items?.length || !deferredSelectedKey) return null;
    return items.find((item) => skillKey(item) === deferredSelectedKey) ?? null;
  }, [items, deferredSelectedKey]);

  async function handleInstall(
    skill: MarketplaceSkill,
    targetAgents: string[]
  ) {
    if (!targetAgents.length) return;
    // Mark specific agents as installing
    setInstallingAgents((prev) => {
      const next = new Set(prev);
      targetAgents.forEach((a) => next.add(a));
      return next;
    });
    try {
      // Check if any agent already has this skill installed locally
      const localSkill = localSkills?.find(
        (s) => s.name === skill.name || s.id === skill.name
      );
      if (localSkill) {
        // Fast path: copy from local installation (no git clone needed)
        await invoke("sync_skill", {
          skillId: localSkill.canonical_path,
          targetAgents,
        });
      } else {
        // Slow path: first install, clone from repository
        await invoke("install_from_marketplace", {
          skill,
          targetAgents,
        });
      }
      // Refresh local skills so "Installed" state updates
      await queryClient.fetchQuery<Skill[]>({
        queryKey: ["skills"],
        queryFn: () => invoke("scan_all_skills"),
        staleTime: 0,
      });
    } catch (e) {
      console.error("Install failed:", e instanceof Error ? e.message : String(e));
    } finally {
      setInstallingAgents((prev) => {
        const next = new Set(prev);
        targetAgents.forEach((a) => next.delete(a));
        return next;
      });
    }
  }

  async function handleUninstall(skillPath: string, agentSlug: string) {
    setInstallingAgents((prev) => new Set(prev).add(agentSlug));
    try {
      await invoke("uninstall_skill", { skillId: skillPath, agentSlug });
      await queryClient.fetchQuery<Skill[]>({
        queryKey: ["skills"],
        queryFn: () => invoke("scan_all_skills"),
        staleTime: 0,
      });
    } catch (e) {
      console.error("Uninstall failed:", e instanceof Error ? e.message : String(e));
    } finally {
      setInstallingAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentSlug);
        return next;
      });
    }
  }

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div
        className="shrink-0 overflow-y-auto p-4 space-y-3"
        style={{ width: listPane.width }}
      >
        <div className="flex items-center gap-2">
          <Store className="size-4" />
          <h1 className="text-sm font-semibold">{t("marketplace.title")}</h1>
        </div>

        {/* Source tabs */}
        <div className="flex items-center gap-4">
          <div className="flex gap-1.5">
            {SOURCES.map((s) => (
              <Button
                key={s.key}
                variant={source === s.key ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setSource(s.key);
                  setSearchQuery("");
                  setSelectedKey(null);
                }}
              >
                {s.label}
              </Button>
            ))}
          </div>

          {/* Sort buttons */}
          {!searchQuery && (
            <div className="flex gap-1">
              {sorts.map((s) => (
                <Button
                  key={s.key}
                  variant={currentSort === s.key ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setSort(s.key)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <SearchInput
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={t("marketplace.searchPlaceholder", { source: source === "skills.sh" ? "skills.sh" : "ClawHub" })}
          debounce={350}
        />

        {/* Results */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="size-4 animate-spin" />
            {t("marketplace.loading")}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-4">
            {t("marketplace.failedToLoad", { error: String(error) })}
          </p>
        ) : !items?.length ? (
          <p className="text-sm text-muted-foreground py-4">
            {t("marketplace.noSkillsFound")}
          </p>
        ) : (
          <div className="space-y-1">
            {items.map((skill) => (
              <MarketplaceListItem
                key={skillKey(skill)}
                skill={skill}
                selected={selectedKey === skillKey(skill)}
                onSelect={setSelectedKey}
              />
            ))}
          </div>
        )}
      </div>

      <ResizeHandle onMouseDown={listPane.onMouseDown} />

      {/* Detail panel */}
      {selectedKey && (
        !selectedSkill ? (
          <div className="flex-1 min-w-0 bg-card flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <MarketplaceSkillDetail
            skill={selectedSkill}
            installingAgents={installingAgents}
            detectedAgents={detectedAgents}
            localSkills={localSkills}
            onInstall={(targets) => handleInstall(selectedSkill, targets)}
            onUninstall={handleUninstall}
            onClose={() => { setSelectedKey(null); }}
          />
        )
      )}
    </div>
  );
}

const MarketplaceListItem = memo(function MarketplaceListItem({
  skill,
  selected,
  onSelect,
}: {
  skill: MarketplaceSkill;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const key = skillKey(skill);
  return (
    <div
      className={`rounded-md border px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/50 ${
        selected
          ? "border-primary bg-accent/30"
          : "border-transparent"
      }`}
      onClick={() => onSelect(key)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium truncate">
          {skill.name}
        </h3>
        {skill.installs != null && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {formatInstalls(skill.installs)}
          </span>
        )}
      </div>
      {skill.description && (
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
          {skill.description}
        </p>
      )}
      <div className="flex items-center gap-2 mt-1">
        {skill.author && (
          <span className="text-[11px] text-muted-foreground truncate">
            {skill.author}
          </span>
        )}
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
          {skill.source}
        </span>
      </div>
    </div>
  );
});

function MarketplaceSkillDetail({
  skill,
  installingAgents,
  detectedAgents,
  localSkills,
  onInstall,
  onUninstall,
  onClose,
}: {
  skill: MarketplaceSkill;
  installingAgents: Set<string>;
  detectedAgents: AgentConfig[];
  localSkills: Skill[] | undefined;
  onInstall: (targetAgents: string[]) => void;
  onUninstall: (skillPath: string, agentSlug: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const anyInstalling = installingAgents.size > 0;

  // Find the matching local skill (if any agent has it installed)
  const localSkill = useMemo(
    () => localSkills?.find((s) => s.name === skill.name || s.id === skill.name),
    [localSkills, skill.name]
  );

  // Compute install status once per relevant update
  const { localAgents, hasAnyInstalled, allInstalled, notInstalledAgents } = useMemo(() => {
    const agents = localSkill ? getInstalledAgents(localSkill) : [];
    const agentSet = new Set(agents);
    const notInstalled = detectedAgents.filter((a) => !agentSet.has(a.slug));
    return {
      localAgents: agents,
      hasAnyInstalled: agents.length > 0,
      allInstalled: detectedAgents.length > 0 && notInstalled.length === 0,
      notInstalledAgents: notInstalled,
    };
  }, [localSkill, detectedAgents]);

  // Defer the heavy markdown rendering so detail panel paints instantly
  const deferredSkillKey = useDeferredValue(skill.name + "|" + skill.source);
  const isStale = deferredSkillKey !== skill.name + "|" + skill.source;

  // Fetch SKILL.md via React Query — cached across skill selections
  const { data: remoteContent, isLoading: contentLoading } = useQuery<
    string | null
  >({
    queryKey: ["skill-content", skill.repository, skill.name],
    queryFn: async () => {
      const text = await invoke<string>("fetch_remote_skill_content", {
        repoUrl: skill.repository,
        skillName: skill.name,
      });
      return extractMarkdownBody(text);
    },
    enabled: !!skill.repository && !isStale,
    staleTime: 30 * 60 * 1000, // SKILL.md content rarely changes; cache 30 min
    retry: false,
  });

  return (
    <div className="flex-1 min-w-0 bg-card flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium truncate">{t("marketplace.detail")}</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-5">
        {/* Header: Name + install action */}
        <div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold leading-tight">
              {skill.name}
            </h2>
            {hasAnyInstalled ? (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-green-500/15 text-green-600 px-2.5 py-1 text-xs font-medium">
                <Check className="size-3" />
                {allInstalled ? t("marketplace.installed") : `${localAgents.length}/${detectedAgents.length}`}
              </span>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="shrink-0 gap-1.5 min-w-[100px]"
                disabled={anyInstalling || !detectedAgents.length || !skill.repository}
                onClick={() =>
                  onInstall(notInstalledAgents.map((a) => a.slug))
                }
              >
                {anyInstalling ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {anyInstalling ? t("marketplace.installing") : t("marketplace.installAll")}
              </Button>
            )}
          </div>
          {/* Author + source badge inline */}
          <div className="flex items-center gap-2 mt-1.5">
            {skill.author && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <User className="size-3" />
                {skill.author}
              </span>
            )}
            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[10px] font-medium">
              {skill.source}
            </span>
            {skill.installs != null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatInstalls(skill.installs)} {t("marketplace.installs").toLowerCase()}
              </span>
            )}
          </div>
        </div>

        <hr className="border-border" />

        {/* Per-agent install status */}
        {detectedAgents.length > 0 && (
          <>
            <InfoSection
              label={t("marketplace.agentsLabel", { installed: localAgents.length, total: detectedAgents.length })}
            >
              <div className="space-y-1.5">
                {detectedAgents.map((agent) => {
                  const isInstalled = localAgents.includes(agent.slug);
                  const installation = localSkill?.installations.find(
                    (i) => i.agent_slug === agent.slug
                  );
                  return (
                    <div
                      key={agent.slug}
                      className={`rounded-md px-2.5 py-2 text-xs ${
                        isInstalled ? "bg-secondary/60" : "bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`size-1.5 rounded-full shrink-0 ${
                              isInstalled
                                ? "bg-green-500"
                                : "bg-muted-foreground/30"
                            }`}
                          />
                          <span
                            className={
                              isInstalled
                                ? "font-medium"
                                : "text-muted-foreground"
                            }
                          >
                            {agent.name}
                          </span>
                        </div>
                        {isInstalled && installation ? (
                          <button
                            className="flex items-center justify-center h-5 w-5 rounded text-destructive/60 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                            title={`Uninstall from ${agent.name}`}
                            disabled={anyInstalling}
                            onClick={() => onUninstall(installation.path, agent.slug)}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        ) : installingAgents.has(agent.slug) ? (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Loader2 className="size-2.5 animate-spin" />
                            {t("marketplace.installing")}
                          </span>
                        ) : (
                          <Button
                            variant="outline"
                            size="xs"
                            className="shrink-0 h-5 px-2 text-[10px]"
                            disabled={anyInstalling || !skill.repository}
                            onClick={() => onInstall([agent.slug])}
                          >
                            <Copy className="size-2.5" />
                            {t("marketplace.install")}
                          </Button>
                        )}
                      </div>
                      {/* Show local path for installed agents */}
                      {installation?.path && (
                        <button
                          className="text-[10px] text-muted-foreground/70 hover:text-primary font-mono mt-1 pl-[18px] break-all text-left leading-relaxed transition-colors cursor-pointer"
                          title="Reveal in Finder"
                          onClick={() => revealItemInDir(installation.path)}
                        >
                          {installation.path}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </InfoSection>
            <hr className="border-border" />
          </>
        )}

        {/* Description as rendered markdown */}
        {skill.description && (
          <MarkdownContent content={skill.description} />
        )}

        <hr className="border-border" />

        {/* Package Info */}
        <InfoSection label={t("marketplace.packageInfo")}>
          <InfoGrid>
            {skill.repository && (
              <InfoRow label={t("marketplace.repository")}>
                <button
                  className="text-xs text-primary hover:underline font-mono break-all text-left inline-flex items-start gap-1 cursor-pointer"
                  onClick={() => openUrl(skill.repository!)}
                >
                  {skill.repository}
                  <ExternalLink className="size-3 shrink-0 mt-0.5" />
                </button>
              </InfoRow>
            )}
            {skill.installs != null && (
              <InfoRow label={t("marketplace.installs")}>
                <span className="text-xs font-medium tabular-nums">
                  {formatInstalls(skill.installs)}
                </span>
                <span className="text-xs text-muted-foreground/60 ml-1.5 tabular-nums">
                  ({skill.installs.toLocaleString()})
                </span>
              </InfoRow>
            )}
          </InfoGrid>
        </InfoSection>

        <hr className="border-border" />

        {/* Quick Actions */}
        <InfoSection label={t("marketplace.actions")}>
          <div className="flex flex-col gap-2">
            {skill.repository && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => openUrl(skill.repository!)}
              >
                <ExternalLink className="size-3.5" />
                {t("marketplace.viewRepository")}
              </Button>
            )}
            {skill.source === "skills.sh" && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => openUrl("https://skills.sh")}
              >
                <Tag className="size-3.5" />
                {t("marketplace.viewOnSkillsSh")}
              </Button>
            )}
          </div>
        </InfoSection>

        <hr className="border-border" />

        {/* Skill Content from remote SKILL.md */}
        <InfoSection label={t("marketplace.skillContent")}>
          {isStale || contentLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("marketplace.loading")}
            </div>
          ) : remoteContent ? (
            <MarkdownContent content={remoteContent} />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {skill.repository
                ? t("marketplace.couldNotLoad")
                : t("marketplace.noRepoUrl")}
            </p>
          )}
        </InfoSection>
      </div>
    </div>
  );
}

function skillKey(skill: MarketplaceSkill): string {
  return `${skill.name}|${skill.source}`;
}

function InfoSection({
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

function InfoGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
      {children}
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <div>{children}</div>
    </>
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

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
