import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import SkillsManager from "./pages/SkillsManager";
import Marketplace from "./pages/Marketplace";
import SettingsPage from "./pages/Settings";
import { useTheme } from "./hooks/useTheme";

function AppInner() {
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  useTheme();

  // Disable default browser/webview context menu globally
  useEffect(() => {
    const prevent = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", prevent);
    return () => document.removeEventListener("contextmenu", prevent);
  }, []);

  // 从后端恢复已保存的语言设置
  useEffect(() => {
    invoke<{ language: string | null }>("read_settings")
      .then((settings) => {
        if (settings.language && settings.language !== i18n.language) {
          void i18n.changeLanguage(settings.language);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("skills-changed", () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["repo-skills"] });
    })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [queryClient]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="skills" element={<SkillsManager />} />
        <Route path="marketplace" element={<Marketplace />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}

