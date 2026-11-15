import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "./lib/language";
import { App } from "./App";
import { EditorSession } from "./components/EditorSession";
import "./ui.css";
import "./resume.css";

createRoot(document.getElementById("root")!).render(<TooltipProvider delayDuration={300}><LanguageProvider><EditorSession>{store => <App store={store} />}</EditorSession></LanguageProvider></TooltipProvider>);
