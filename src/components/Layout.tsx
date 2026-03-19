import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { LayoutDashboard, Puzzle, Store, Settings } from "lucide-react";
import { useResizable } from "@/hooks/useResizable";
import ResizeHandle from "@/components/ResizeHandle";

export default function Layout() {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState<string>("");

  const navItems = [
    { to: "/", icon: LayoutDashboard, label: t("sidebar.dashboard") },
    { to: "/skills", icon: Puzzle, label: t("sidebar.skills") },
    { to: "/marketplace", icon: Store, label: t("sidebar.marketplace") },
    { to: "/settings", icon: Settings, label: t("sidebar.settings") },
  ];

  useEffect(() => {
    let active = true;
    getVersion()
      .then((version) => {
        if (active) {
          setAppVersion(version);
        }
      })
      .catch(() => {
        if (active) {
          setAppVersion("");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const sidebar = useResizable({
    initial: 200,
    min: 140,
    max: 320,
    storageKey: "sidebar-width",
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className="flex shrink-0 flex-col bg-sidebar"
        style={{ width: sidebar.width }}
      >
        {/* App title */}
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
          <Puzzle className="size-5 text-sidebar-primary" />
          <span className="text-sm font-semibold text-sidebar-foreground">
            AgentSkills
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {appVersion ? `v${appVersion}` : "v--"}
          </p>
        </div>
      </aside>

      <ResizeHandle onMouseDown={sidebar.onMouseDown} />

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
