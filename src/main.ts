import "./styles/main.css";
import { mountApp } from "./app/app";

const root = document.getElementById("app");
if (!root) {
  throw new Error("App root not found.");
}

mountApp(root);
