import { useMemo, useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Puzzle,
  MonitorCheck,
  CircleOff,
  ArrowRight,
  RefreshCw,
  Copy,
  X,
} from "lucide-react";
import { useAgents } from "@/hooks/useAgents";
import { useSkills, installedAgents } from "@/hooks/useSkills";
import LiquidGlass from "@/components/LiquidGlass";
import { Button } from "@/components/ui/button";
import SearchInput from "@/components/SearchInput";
import { cn, nativeSelectClass } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";

export default function Dashboard() {
  const { t } = useTranslation();
  const {
    data: agents,
    isLoading: agentsLoading,
    isFetching: agentsFetching,
    refetch: refetchAgents,
  } = useAgents();
  const {
    data: skills,
    isLoading: skillsLoading,
    isFetching: skillsFetching,
    refetch: refetchSkills,
  } = useSkills();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "detected" | "not-installed">("all");
  const [sortBy, setSortBy] = useState<"name" | "skills">("name");
  const [guideAgent, setGuideAgent] = useState<string | null>(null);

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];
  const totalSkills = skills?.length ?? 0;
  const isRefreshing = agentsFetching || skillsFetching;

  const skillCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents ?? []) {
      counts.set(agent.slug, 0);
    }
    for (const skill of skills ?? []) {
      for (const slug of installedAgents(skill)) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    return counts;
  }, [agents, skills]);

  const filteredAgents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (agents ?? [])
      .filter((agent) => {
        if (!query) return true;
        const haystack = [
          agent.name,
          agent.slug,
          agent.cli_command ?? "",
          ...agent.global_paths,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .filter((agent) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "detected") return agent.detected;
        return !agent.detected;
      })
      .sort((a, b) => {
        if (sortBy === "skills") {
          const bySkills = (skillCountByAgent.get(b.slug) ?? 0) - (skillCountByAgent.get(a.slug) ?? 0);
          if (bySkills !== 0) return bySkills;
        }
        if (a.detected !== b.detected) return a.detected ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [agents, searchTerm, statusFilter, sortBy, skillCountByAgent]);

  const selectedGuide = useMemo(
    () => (agents ?? []).find((agent) => agent.slug === guideAgent) ?? null,
    [agents, guideAgent]
  );

  return (
    <div className="p-6 space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5" />
          <h1 className="text-lg font-semibold tracking-tight">{t("dashboard.title")}</h1>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label={t("dashboard.detectedAgents")}
          value={agentsLoading ? null : detectedAgents.length}
          total={agents?.length}
          icon={<MonitorCheck className="size-4 text-primary/70" />}
        />
        <StatCard
          label={t("dashboard.installedSkills")}
          value={skillsLoading ? null : totalSkills}
          icon={<Puzzle className="size-4 text-primary/70" />}
        />
      </div>

      {/* Agent cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("dashboard.agents")}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("dashboard.detectedOf", { detected: detectedAgents.length, total: agents?.length ?? 0 })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={isRefreshing}
              onClick={() => {
                void Promise.all([refetchAgents(), refetchSkills()]);
              }}
              title={t("dashboard.refreshTitle")}
            >
              <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center">
          <div className="w-full md:max-w-[280px] md:shrink-0">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={t("dashboard.searchPlaceholder")}
              debounce={0}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <select
              className={cn(nativeSelectClass, "min-w-[7rem]")}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "detected" | "not-installed")}
            >
              <option value="all">{t("dashboard.filterAll")}</option>
              <option value="detected">{t("dashboard.filterDetected")}</option>
              <option value="not-installed">{t("dashboard.filterNotInstalled")}</option>
            </select>
            <select
              className={cn(nativeSelectClass, "min-w-[7.5rem]")}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "name" | "skills")}
            >
              <option value="name">{t("dashboard.sortName")}</option>
              <option value="skills">{t("dashboard.sortSkills")}</option>
            </select>
          </div>
        </div>
        {agentsLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl p-4 glass">
                <div className="flex items-start gap-3">
                  <div className="size-9 rounded-lg animate-skeleton shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-24 rounded animate-skeleton" />
                    <div className="h-3 w-16 rounded animate-skeleton" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("dashboard.noAgentsMatch")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredAgents.map((agent) => {
              const agentSkillCount = skillCountByAgent.get(agent.slug) ?? 0;

              return (
                <LiquidGlass
                  key={agent.slug}
                  className="group flex items-center gap-3 rounded-2xl p-4 text-left glass-hover cursor-pointer"
                  onClick={() => {
                    if (agent.detected) {
                      navigate("/skills?agent=" + agent.slug);
                    } else {
                      setGuideAgent(agent.slug);
                    }
                  }}
                >
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                      agent.detected
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {agent.detected ? (
                      <MonitorCheck className="size-4" />
                    ) : (
                      <CircleOff className="size-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 relative z-[3]">
                    <span className="text-sm font-medium truncate">
                      {agent.name}
                    </span>
                    {agent.detected ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("dashboard.skillCount", { count: agentSkillCount })}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">{t("dashboard.notInstalled")}</p>
                    )}
                  </div>
                  <div className="relative z-[3]">
                    {agent.detected ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); navigate("/skills?agent=" + agent.slug); }}
                        title={`Open ${agent.name} skills`}
                      >
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="xs"
                        className="shrink-0"
                        onClick={(e) => { e.stopPropagation(); setGuideAgent(agent.slug); }}
                      >
                        {t("dashboard.installationGuide")}
                      </Button>
                    )}
                  </div>
                </LiquidGlass>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent skills */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("dashboard.recentSkills")}
          </h2>
          {totalSkills > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => navigate("/skills")}
            >
              {t("dashboard.viewAll")}
              <ArrowRight className="size-3" />
            </Button>
          )}
        </div>
        {skillsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl px-4 py-3 glass">
                <div className="flex items-center gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded animate-skeleton" />
                    <div className="h-3 w-48 rounded animate-skeleton" />
                  </div>
                  <div className="h-5 w-14 rounded-full animate-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : !skills?.length ? (
          <div className="rounded-2xl border border-dashed border-black/[0.06] dark:border-white/[0.06] p-10 text-center">
            <div className="inline-flex size-14 items-center justify-center rounded-2xl glass mb-4">
              <Puzzle className="size-7 text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.noSkillsYet")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => navigate("/marketplace")}
            >
              {t("dashboard.browseMarketplace")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {skills.slice(0, 5).map((skill) => (
              <LiquidGlass
                key={skill.id}
                className="group flex items-center justify-between rounded-2xl px-4 py-3 glass-hover"
              >
                <div className="min-w-0 flex-1 relative z-[3]">
                  <span className="text-sm font-medium truncate block">
                    {skill.name}
                  </span>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {skill.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0 ml-3 relative z-[3]">
                  {installedAgents(skill).map((slug) => (
                    <span
                      key={slug}
                      className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                    >
                      {agents?.find((a) => a.slug === slug)?.name ?? slug}
                    </span>
                  ))}
                </div>
              </LiquidGlass>
            ))}
          </div>
        )}
      </div>

      <InstallGuideModal
        agent={selectedGuide}
        onClose={() => setGuideAgent(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  total,
  icon,
}: {
  label: string;
  value: number | null;
  total?: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-4 glass glass-stat glass-shine-always">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex size-7 items-center justify-center rounded-xl bg-primary/10">
          {icon}
        </div>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        {value == null ? (
          <div className="h-8 w-10 rounded animate-skeleton" />
        ) : (
          <span className="text-2xl font-bold tabular-nums tracking-tight">{value}</span>
        )}
        {total != null && value != null && (
          <span className="text-sm text-muted-foreground/60 font-medium">/ {total}</span>
        )}
      </div>
    </div>
  );
}

function InstallGuideModal({
  agent,
  onClose,
}: {
  agent: {
    slug: string;
    name: string;
    cli_command: string | null;
    install_command: string | null;
    install_command_windows: string | null;
    install_docs_url: string | null;
    install_source_label: string | null;
    global_paths: string[];
  } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agent) return;
    panelRef.current?.focus();
  }, [agent]);

  if (!agent) return null;
  const isWindows = navigator.userAgent.includes("Windows");
  const installCommand = (isWindows
    ? agent.install_command_windows ?? agent.install_command
    : agent.install_command
  )?.trim();

  function formatInstallSourceLabel(label: string | null): string {
    switch (label) {
      case "official-docs":
        return t("dashboard.sourceOfficialDocs");
      case "official-help-center":
        return t("dashboard.sourceOfficialHelpCenter");
      case "official-readme":
        return t("dashboard.sourceOfficialReadme");
      case "official-marketplace":
        return t("dashboard.sourceOfficialMarketplace");
      case "homebrew-cask":
        return t("dashboard.sourceHomebrewCask");
      default:
        return t("dashboard.sourceUnspecified");
    }
  }

  const installSourceLabel = formatInstallSourceLabel(agent.install_source_label);
  const verifyCommand = agent.cli_command
    ? `${agent.cli_command} --version`
    : "";
  const lookupCommand = agent.cli_command
    ? `which ${agent.cli_command}`
    : "";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 dark:bg-black/40 p-4 animate-backdrop-in"
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-dialog-title"
        className="w-full max-w-lg rounded-3xl p-5 outline-none animate-modal-in glass-elevated"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 id="install-guide-dialog-title" className="text-sm font-semibold">
            {t("dashboard.installGuideTitle", { name: agent.name })}
          </h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{t("dashboard.source")}</span>
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {installSourceLabel}
            </span>
          </div>
          <p>{t("dashboard.diagnoseTip")}</p>
          {verifyCommand ? (
            <CommandBlock label={t("dashboard.versionCheck")} command={verifyCommand} />
          ) : null}
          {lookupCommand ? (
            <CommandBlock label={t("dashboard.pathLookup")} command={lookupCommand} />
          ) : null}
          {installCommand ? (
            <CommandBlock label={t("dashboard.installCommand")} command={installCommand} />
          ) : null}
          {agent.install_docs_url?.trim() ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => openUrl(agent.install_docs_url!)}
            >
              {t("dashboard.openDocs")}
            </Button>
          ) : null}
          <div>
            <p className="mb-1 font-medium text-foreground">{t("dashboard.expectedPaths")}</p>
            <ul className="space-y-1">
              {agent.global_paths.map((path) => (
                <li key={path} className="font-mono text-[11px]">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommandBlock({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-xl glass-inset p-2.5">
        <code className="flex-1 break-all text-[11px] text-foreground">{command}</code>
        <Button
          variant="outline"
          size="xs"
          onClick={() => navigator.clipboard.writeText(command)}
        >
          <Copy className="size-3" />
          {t("dashboard.copy")}
        </Button>
      </div>
    </div>
  );
}
