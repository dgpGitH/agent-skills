import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings as SettingsIcon, Trash2, Check, Globe, GitBranch, RefreshCw, Palette, Info, ExternalLink, X as XIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAccentColor } from "@/hooks/useAccentColor";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "@/components/ui/button";
import { useRepos, useRemoveRepo, useSyncRepo } from "@/hooks/useRepos";

interface AppSettings {
  theme: string | null;
  language: string | null;
  path_overrides: Record<string, string[]> | null;
  close_action: string | null;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: null,
  language: null,
  path_overrides: null,
  close_action: null,
};

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh-CN", label: "中文" },
];

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [cacheCleared, setCacheCleared] = useState(false);
  const { accent, setAccent, presets } = useAccentColor();
  const { data: repos } = useRepos();
  const removeRepo = useRemoveRepo();
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);
  const syncRepo = useSyncRepo();

  const { data: settings, isLoading } = useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: () => invoke("read_settings"),
  });

  const saveMutation = useMutation({
    mutationFn: (s: AppSettings) => invoke("write_settings", { settings: s }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  async function handleClearCache() {
    try {
      await invoke("clear_marketplace_cache");
      await queryClient.invalidateQueries({ queryKey: ["marketplace"] });
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 2000);
    } catch (e) {
      console.error("Clear cache failed:", e instanceof Error ? e.message : String(e));
    }
  }

  function handleLanguageChange(langCode: string) {
    void i18n.changeLanguage(langCode);
    saveMutation.mutate({
      ...(settings ?? DEFAULT_SETTINGS),
      language: langCode,
    });
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 animate-fade-in-up">
        <div className="flex items-center gap-2">
          <SettingsIcon className="size-5" />
          <h1 className="text-lg font-semibold tracking-tight">{t("settings.title")}</h1>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl p-5 glass-panel glass-shine-always space-y-3">
              <div className="h-4 w-24 rounded animate-skeleton" />
              <div className="h-3 w-48 rounded animate-skeleton" />
              <div className="h-8 w-32 rounded-lg animate-skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const currentLang = i18n.language;

  return (
    <div className="p-6 space-y-5 animate-fade-in-up">
      <div className="flex items-center gap-2">
        <SettingsIcon className="size-5" />
        <h1 className="text-lg font-semibold tracking-tight">{t("settings.title")}</h1>
      </div>

      {/* Theme */}
      <section className="rounded-2xl p-5 glass-panel glass-shine-always space-y-3">
        <h2 className="text-sm font-medium">{t("settings.theme")}</h2>
        <div className="flex gap-1.5">
          {(["light", "dark", "system"] as const).map((themeOption) => {
            const current = settings?.theme ?? "system";
            const isActive =
              current === themeOption || (themeOption === "system" && !settings?.theme);
            return (
              <Button
                key={themeOption}
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  saveMutation.mutate({
                    ...(settings ?? DEFAULT_SETTINGS),
                    theme: themeOption === "system" ? null : themeOption,
                  })
                }
              >
                {t(`settings.${themeOption}`)}
              </Button>
            );
          })}
        </div>
      </section>

      {/* Accent Color */}
      <section className="rounded-2xl p-5 glass-panel glass-shine-always space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <Palette className="size-4" />
          {t("settings.accentColor")}
        </h2>
        <div className="flex gap-2 flex-wrap">
          {presets.map((p) => {
            const isActive = accent === p.key;
            const labelKey = `settings.accent${p.key.charAt(0).toUpperCase() + p.key.slice(1)}` as const;
            return (
              <button
                key={p.key}
                onClick={() => setAccent(p.key)}
                className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 cursor-pointer border ${
                  isActive
                    ? "glass border-current/20 shadow-sm"
                    : "border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                }`}
              >
                <span
                  className="size-4 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/15"
                  style={{ background: p.swatch }}
                />
                <span className={isActive ? "text-primary" : "text-muted-foreground"}>
                  {t(labelKey)}
                </span>
                {isActive && <Check className="size-3 text-primary" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* Language */}
      <section className="rounded-2xl p-5 glass-panel glass-shine-always space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <Globe className="size-4" />
          {t("settings.language")}
        </h2>
        <div className="flex gap-1.5">
          {LANGUAGES.map((lang) => (
            <Button
              key={lang.code}
              variant={currentLang === lang.code ? "default" : "outline"}
              size="sm"
              onClick={() => handleLanguageChange(lang.code)}
            >
              {lang.label}
            </Button>
          ))}
        </div>
      </section>

      {/* Close Behavior */}
      <section className="rounded-2xl p-5 glass-panel glass-shine-always space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <XIcon className="size-4" />
          {t("settings_close.closeBehavior")}
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("settings_close.closeBehaviorDescription")}
        </p>
        <div className="flex gap-1.5">
          {([null, "minimize", "quit"] as const).map((option) => {
            const current = settings?.close_action ?? null;
            const isActive = current === option;
            const labelKey = option === null ? "settings_close.ask" : `settings_close.${option}`;
            return (
              <Button
                key={option ?? "ask"}
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  saveMutation.mutate({
                    ...(settings ?? DEFAULT_SETTINGS),
                    close_action: option,
                  })
                }
              >
                {t(labelKey)}
              </Button>
            );
          })}
        </div>
      </section>

      {/* Cache */}
      <section className="rounded-2xl p-5 glass-panel glass-shine-always space-y-3">
        <h2 className="text-sm font-medium">{t("settings.marketplaceCache")}</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("settings.cacheDescription")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearCache}
          disabled={cacheCleared}
        >
          {cacheCleared ? (
            <>
              <Check className="size-3.5" />
              {t("settings.cleared")}
            </>
          ) : (
            <>
              <Trash2 className="size-3.5" />
              {t("settings.clearCache")}
            </>
          )}
        </Button>
      </section>

      {/* Skill Repos */}
      <section className="rounded-2xl p-5 glass-panel glass-shine-always space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <GitBranch className="size-4" />
          {t("repos.skillRepos")}
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("repos.reposDescription")}
        </p>
        {repos && repos.length > 0 ? (
          <div className="space-y-1.5">
            {repos.map((repo) => {
              const isLocal = repo.id.startsWith("local-");
              return (
                <div
                  key={repo.id}
                  className="rounded-xl glass-inset px-3 py-2.5 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{repo.name}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        isLocal
                          ? "bg-amber-500/15 text-amber-600"
                          : "bg-blue-500/15 text-blue-600"
                      }`}>
                        {isLocal ? t("repos.localSource") : t("repos.gitSource")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {!isLocal && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t("repos.sync")}
                          disabled={syncRepo.isPending}
                          onClick={() => syncRepo.mutate(repo.id)}
                        >
                          <RefreshCw className={`size-3 ${syncRepo.isPending ? "animate-spin" : ""}`} />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t("repos.remove")}
                        disabled={removeRepo.isPending}
                        onClick={() => removeRepo.mutate(repo.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-muted-foreground font-mono break-all">{repo.repo_url}</p>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{t("repos.skillCountLabel", { count: repo.skill_count })}</span>
                    {!isLocal && repo.last_synced && (
                      <span>{t("repos.lastSynced", { time: new Date(repo.last_synced).toLocaleString() })}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-black/[0.06] dark:border-white/[0.06] p-4 text-center">
            <p className="text-xs text-muted-foreground">{t("repos.noRepos")}</p>
          </div>
        )}
      </section>

      {/* About */}
      <section className="rounded-2xl p-5 glass-panel glass-shine-always space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <Info className="size-4" />
          {t("settings.about")}
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">AgentSkills</span>
          {appVersion && (
            <span className="rounded-full glass-badge px-2 py-0.5 text-[10px] font-medium tabular-nums">
              v{appVersion}
            </span>
          )}
        </div>
        <button
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer"
          onClick={() => openUrl("https://github.com/chrlsio/agent-skills")}
        >
          <GitBranch className="size-3" />
          github.com/chrlsio/agent-skills
          <ExternalLink className="size-3" />
        </button>
      </section>

    </div>
  );
}
