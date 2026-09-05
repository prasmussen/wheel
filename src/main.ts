import "./style.css";
import { App } from "./app/App";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root not found.");
void new App(root).start();
