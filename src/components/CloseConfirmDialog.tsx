import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

interface AppSettings {
  theme: string | null;
  language: string | null;
  path_overrides: Record<string, string[]> | null;
  close_action: string | null;
}

interface Props {
  open: boolean;
  onDone: () => void;
}

export default function CloseConfirmDialog({ open, onDone }: Props) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);
  const queryClient = useQueryClient();

  const act = useMutation({
    mutationFn: async (action: "minimize" | "quit") => {
      if (remember) {
        const settings = await invoke<AppSettings>("read_settings");
        await invoke("write_settings", {
          settings: { ...settings, close_action: action },
        });
        queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
      if (action === "minimize") {
        await invoke("close_minimize");
      } else {
        await invoke("close_quit");
      }
    },
    onSettled: () => onDone(),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onDone} />
      <div className="relative z-10 w-80 rounded-2xl glass-panel p-5 space-y-4 shadow-xl border border-border/50">
        <h2 className="text-sm font-semibold">{t("close.title")}</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("close.description")}
        </p>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center"
            onClick={() => act.mutate("minimize")}
            disabled={act.isPending}
          >
            {t("close.minimize")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center"
            onClick={() => act.mutate("quit")}
            disabled={act.isPending}
          >
            {t("close.quit")}
          </Button>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-xs text-muted-foreground">{t("close.remember")}</span>
        </label>
      </div>
    </div>
  );
}
