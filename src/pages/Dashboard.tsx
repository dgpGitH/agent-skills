import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Puzzle,
  MonitorCheck,
  CircleOff,
  ArrowRight,
  Search,
  RefreshCw,
  Copy,
  X,
} from "lucide-react";
import { useAgents } from "@/hooks/useAgents";
import { useSkills, installedAgents } from "@/hooks/useSkills";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-5" />
          <h1 className="text-lg font-semibold">{t("dashboard.title")}</h1>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label={t("dashboard.detectedAgents")}
          value={agentsLoading ? "..." : detectedAgents.length}
          total={agents?.length}
          icon={<MonitorCheck className="size-4 text-muted-foreground" />}
        />
        <StatCard
          label={t("dashboard.installedSkills")}
          value={skillsLoading ? "..." : totalSkills}
          icon={<Puzzle className="size-4 text-muted-foreground" />}
        />
      </div>

      {/* Agent cards */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("dashboard.agents")}</h2>
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
          <div className="relative md:w-[280px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              placeholder={t("dashboard.searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "detected" | "not-installed")}
            >
              <option value="all">{t("dashboard.filterAll")}</option>
              <option value="detected">{t("dashboard.filterDetected")}</option>
              <option value="not-installed">{t("dashboard.filterNotInstalled")}</option>
            </select>
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "name" | "skills")}
            >
              <option value="name">{t("dashboard.sortName")}</option>
              <option value="skills">{t("dashboard.sortSkills")}</option>
            </select>
          </div>
        </div>
        {agentsLoading ? (
          <p className="text-sm text-muted-foreground">{t("dashboard.loadingAgents")}</p>
        ) : filteredAgents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("dashboard.noAgentsMatch")}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredAgents.map((agent) => {
              const agentSkillCount = skillCountByAgent.get(agent.slug) ?? 0;

              return (
                <div
                  key={agent.slug}
                  className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent/50 disabled:opacity-60 disabled:cursor-default disabled:hover:bg-card"
                >
                  <div
                    className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md ${
                      agent.detected
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {agent.detected ? (
                      <MonitorCheck className="size-4" />
                    ) : (
                      <CircleOff className="size-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {agent.name}
                      </span>
                      {agent.detected && (
                        <span className="shrink-0 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                          {t("dashboard.detected")}
                        </span>
                      )}
                    </div>
                    {agent.detected ? (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t("dashboard.skillCount", { count: agentSkillCount })}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">{t("dashboard.notInstalled")}</p>
                    )}
                  </div>
                  {agent.detected ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="mt-0.5 shrink-0"
                      onClick={() => navigate("/skills?agent=" + agent.slug)}
                      title={`Open ${agent.name} skills`}
                    >
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="xs"
                      className="mt-0.5 shrink-0"
                      onClick={() => setGuideAgent(agent.slug)}
                    >
                      {t("dashboard.installationGuide")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent skills */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">{t("dashboard.scanning")}</p>
        ) : !skills?.length ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Puzzle className="size-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {t("dashboard.noSkillsYet")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => navigate("/marketplace")}
            >
              {t("dashboard.browseMarketplace")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {skills.slice(0, 5).map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium truncate block">
                    {skill.name}
                  </span>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {skill.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0 ml-3">
                  {installedAgents(skill).map((slug) => (
                    <span
                      key={slug}
                      className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                    >
                      {agents?.find((a) => a.slug === slug)?.name ?? slug}
                    </span>
                  ))}
                </div>
              </div>
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
  value: string | number;
  total?: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold">{value}</span>
        {total != null && (
          <span className="text-sm text-muted-foreground">/ {total}</span>
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
    install_docs_url: string | null;
    install_source_label: string | null;
    global_paths: string[];
  } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!agent) return null;
  const installCommand = agent.install_command?.trim();

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("dashboard.installGuideTitle", { name: agent.name })}</h3>
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
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
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
