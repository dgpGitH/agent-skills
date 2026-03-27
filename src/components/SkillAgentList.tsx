import { memo } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentRow } from "@/components/AgentRow";
import type { AgentConfig } from "@/hooks/useAgents";
import type { Skill, SkillInstallation } from "@/hooks/useSkills";

export type BusyOp = "installing" | "syncing" | "uninstalling";

/** Composite key for busyAgents map: "skillId\0agentSlug" */
export function busyKey(skillId: string, agentSlug: string): string {
  return `${skillId}\0${agentSlug}`;
}

interface SkillAgentListProps {
  /** Local skill data (may be undefined for marketplace-only skills) */
  skill?: Skill;
  /** Override skill ID for busy key matching (e.g. skill.name for first-time marketplace installs) */
  skillIdOverride?: string;
  /** All detected agents to display rows for */
  detectedAgents: AgentConfig[];
  /** Map of busyKey(skillId, agentSlug) → current busy operation */
  busyAgents: Map<string, BusyOp>;
  /** Called to install/sync the skill to the given agents */
  onInstall: (targetAgents: string[]) => void;
  /** Called to uninstall the skill from a specific agent (receives skillId, agentSlug) */
  onUninstall: (skillId: string, agentSlug: string) => void;
}

/**
 * Shared agent list used by both SkillsManager detail and Marketplace detail.
 * Renders one AgentRow per detected agent with unified status, labels, and busy states.
 */
export const SkillAgentList = memo(function SkillAgentList({
  skill,
  skillIdOverride,
  detectedAgents,
  busyAgents,
  onInstall,
  onUninstall,
}: SkillAgentListProps) {
  const { t } = useTranslation();
  // If a local skill exists, the canonical copy is available — use sync (fast copy), not install (git clone)
  const hasLocal = !!skill;
  // Check if any agent for THIS skill is busy
  const skillId = skill?.id ?? skillIdOverride;
  const anyBusy = skillId
    ? detectedAgents.some((a) => busyAgents.has(busyKey(skillId, a.slug)))
    : false;

  return (
    <div className="space-y-1.5">
      {detectedAgents.map((agent) => {
        const installation = skill?.installations.find(
          (i) => i.agent_slug === agent.slug
        );
        const isDirect = installation ? !installation.is_inherited : false;
        const isInherited = installation?.is_inherited ?? false;
        const status = isDirect
          ? "installed"
          : isInherited
            ? "inherited"
            : "not-installed";

        const sourceTag = resolveSourceTag(
          installation,
          isInherited,
          detectedAgents,
          t,
        );

        const key = skillId ? busyKey(skillId, agent.slug) : "";
        const busyOp = busyAgents.get(key);
        const actionLabel = hasLocal ? t("marketplace.sync") : t("marketplace.install");

        return (
          <AgentRow
            key={agent.slug}
            name={agent.name}
            status={status}
            path={installation?.path}
            tags={sourceTag ? (
              <span className="text-[10px] text-muted-foreground/60 shrink-0">
                {t("skills.via", { name: sourceTag })}
              </span>
            ) : undefined}
            onUninstall={isDirect && skill ? () => onUninstall(skill.id, agent.slug) : undefined}
            onInstall={() => onInstall([agent.slug])}
            uninstallTitle={`${t("skills.uninstall")} ${agent.name}`}
            installLabel={actionLabel}
            installTitle={`${actionLabel} → ${agent.name}`}
            revealTitle={t("skills.revealInFinder")}
            disabled={anyBusy}
            action={busyOp ? (
              <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="size-2.5 animate-spin" />
                {t(`marketplace.${busyOp}`)}
              </span>
            ) : undefined}
          />
        );
      })}
    </div>
  );
});

/** Compute installed agent count (direct + inherited, filtered to detected agents only) */
export function installedAgentCount(
  skill: Skill | undefined,
  detectedAgents: AgentConfig[],
): number {
  if (!skill) return 0;
  const detected = new Set(detectedAgents.map((a) => a.slug));
  return skill.installations.filter((i) => detected.has(i.agent_slug)).length;
}

function resolveSourceTag(
  installation: SkillInstallation | undefined,
  isInherited: boolean,
  detectedAgents: AgentConfig[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | undefined {
  if (!isInherited || !installation?.inherited_from) return undefined;
  if (installation.inherited_from === "shared") return t("skills.sharedDirectory");
  return detectedAgents.find((a) => a.slug === installation.inherited_from)?.name
    ?? installation.inherited_from;
}
