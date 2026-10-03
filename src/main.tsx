import { render } from "preact";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("找不到應用程式容器。");

render(<App />, root);
