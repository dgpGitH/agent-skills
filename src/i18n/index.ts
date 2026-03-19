import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en";
import zhCN from "./zh-CN";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: "en", // 默认语言，将在 App 启动时被覆盖
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React 已做 XSS 转义
  },
});

export default i18n;
