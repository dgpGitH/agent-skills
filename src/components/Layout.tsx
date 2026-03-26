import { NavLink, Outlet, useSearchParams } from "react-router-dom";
import { memo, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { LayoutDashboard, Puzzle, Store, Settings, GitBranch, FolderOpen } from "lucide-react";
import logoUrl from "@/assets/logo.png";
import { getAgentIcon } from "@/lib/agentIcons";
import { Button } from "@/components/ui/button";
import ImportWizard from "@/components/ImportWizard";
import { useResizable } from "@/hooks/useResizable";
import ResizeHandle from "@/components/ResizeHandle";
import { useAgents } from "@/hooks/useAgents";
import { useSkills, allAgents } from "@/hooks/useSkills";

// Hoisted outside component — stable reference, no re-creation per render
const NAV_LINK_BASE = "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium border outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-[color,background-color,border-color,box-shadow,opacity] duration-150";
const NAV_LINK_ACTIVE = `${NAV_LINK_BASE} bg-primary/[0.08] dark:bg-primary/[0.12] border-primary/20 dark:border-primary/15 shadow-[inset_0_1px_0_var(--primary)/8%,0_0_8px_var(--primary)/6%] text-primary backdrop-blur-sm`;
const NAV_LINK_INACTIVE = `${NAV_LINK_BASE} border-transparent text-sidebar-foreground/75 hover:text-primary/80 hover:bg-primary/[0.04] dark:hover:bg-primary/[0.06]`;

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE;
}

// Extracted component — avoids IIFE and inline component per agent
const AgentIcon = memo(function AgentIcon({ slug }: { slug: string }) {
  const icon = getAgentIcon(slug);
  return icon.type === "component"
    ? <icon.Component className="size-4 rounded-[3px]" aria-hidden="true" />
    : <img src={icon.src} alt="" className="size-4 rounded-[3px]" />;
});

export default function Layout() {
  const { t } = useTranslation();
  const [importMode, setImportMode] = useState<"git" | "local" | null>(null);
  const { data: agents } = useAgents();
  const { data: skills } = useSkills();
  const [searchParams] = useSearchParams();

  const detectedAgents = useMemo(
    () => agents?.filter((a) => a.detected) ?? [],
    [agents],
  );

  // Count skills per agent (direct + inherited = all available)
  const skillCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skills ?? []) {
      for (const slug of allAgents(skill)) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    return counts;
  }, [skills]);

  const sidebar = useResizable({
    initial: 200,
    min: 200,
    max: 320,
    storageKey: "sidebar-width",
  });

  const onDragRegionMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.buttons !== 1) return;
    e.preventDefault();
    if (e.detail === 2) {
      getCurrentWindow().toggleMaximize();
    } else {
      getCurrentWindow().startDragging();
    }
  }, []);

  // Determine which agent is currently selected from URL
  const activeAgentSlug = searchParams.get("agent");

  return (
    <div className="relative flex h-screen overflow-hidden bg-background">

      {/* Sidebar — floating glass panel */}
      <aside
        aria-label="Sidebar"
        className="flex shrink-0 flex-col m-2 mr-0 rounded-2xl glass-panel"
        style={{ width: sidebar.width }}
      >
        {/* Draggable title bar + logo (traffic lights sit in upper portion) */}
        <div
          className="shrink-0 flex items-end px-3 pt-[42px] pb-3 cursor-default"
          onMouseDown={onDragRegionMouseDown}
        >
          <div className="flex items-center gap-2.5">
            <img src={logoUrl} alt="" width={30} height={30} className="size-[30px] rounded-[8px] shadow-sm ring-1 ring-black/5" />
            <span className="text-[15px] font-semibold text-sidebar-foreground tracking-tight select-none">
              AgentSkills
            </span>
          </div>
        </div>

        {/* Import buttons */}
        <div className="px-3 pb-3 space-y-1.5">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 rounded-xl border-dashed"
            onClick={() => setImportMode("git")}
          >
            <GitBranch className="size-3.5" aria-hidden="true" />
            {t("repos.importRepo")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 rounded-xl border-dashed"
            onClick={() => setImportMode("local")}
          >
            <FolderOpen className="size-3.5" aria-hidden="true" />
            {t("repos.importLocal")}
          </Button>
        </div>

        {/* Main nav + agents in scrollable area */}
        <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
          {/* Top nav */}
          <NavLink to="/" end className={navLinkClass}>
            <LayoutDashboard className="size-4" aria-hidden="true" />
            {t("sidebar.dashboard")}
          </NavLink>

          <NavLink to="/skills" end className={({ isActive }) => {
            const reallyActive = isActive && !activeAgentSlug;
            return navLinkClass({ isActive: reallyActive });
          }}>
            <Puzzle className="size-4" aria-hidden="true" />
            {t("sidebar.skills")}
            {skills && (
              <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
                {skills.length}
              </span>
            )}
          </NavLink>

          <NavLink to="/marketplace" className={navLinkClass}>
            <Store className="size-4" aria-hidden="true" />
            {t("sidebar.marketplace")}
          </NavLink>

          {/* Agents section */}
          {detectedAgents.length > 0 && (
            <div className="mt-4">
              <h2 className="px-3 mb-2 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                {t("sidebar.agents")}
              </h2>
              <div className="flex flex-col gap-0.5">
                {detectedAgents.map((agent) => {
                  const count = skillCountByAgent.get(agent.slug) ?? 0;
                  const isActive = activeAgentSlug === agent.slug;
                  return (
                    <NavLink
                      key={agent.slug}
                      to={`/skills?agent=${agent.slug}`}
                      className={() => navLinkClass({ isActive })}
                    >
                      <AgentIcon slug={agent.slug} />
                      <span className="truncate">{agent.name}</span>
                      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
                        {count}
                      </span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Bottom nav */}
          <div className="pt-2">
            <NavLink to="/settings" className={navLinkClass}>
              <Settings className="size-4" aria-hidden="true" />
              {t("sidebar.settings")}
            </NavLink>
          </div>
        </nav>

      </aside>

      <ResizeHandle onMouseDown={sidebar.onMouseDown} />

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col relative">
        {/* Draggable title bar — overlay, does not push content down */}
        <div
          className="absolute inset-x-0 top-0 h-[42px] z-10 cursor-default select-none"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          onMouseDown={onDragRegionMouseDown}
        />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {importMode && <ImportWizard mode={importMode} onClose={() => setImportMode(null)} />}
    </div>
  );
}
