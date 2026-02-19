import "./styles/main.css";
import { mountApp } from "./app/app";
import { applyResolvedTheme, readThemeMode, resolveTheme } from "./util/theme";

const root = document.getElementById("app");
if (!root) {
  throw new Error("App root not found.");
}

const themeMode = readThemeMode();
applyResolvedTheme(resolveTheme(themeMode));

mountApp(root);
