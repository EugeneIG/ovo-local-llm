import { useEffect, useState } from "react";
import { Sidebar, type NavKey } from "./Sidebar";
import { SidecarIndicator } from "./SidecarIndicator";
import { ChatPane } from "../panes/ChatPane";
import { ModelsPane } from "../panes/ModelsPane";
import { SettingsPane } from "../panes/SettingsPane";
import { AboutPane } from "../panes/AboutPane";
import { useSidecarStore } from "../store/sidecar";

export function AppShell() {
  const [active, setActive] = useState<NavKey>("chat");
  const subscribe = useSidecarStore((s) => s.subscribe);
  const unsubscribe = useSidecarStore((s) => s.unsubscribe);

  useEffect(() => {
    void subscribe();
    return () => unsubscribe();
  }, [subscribe, unsubscribe]);

  return (
    <div className="h-screen flex bg-[#FAF3E7] text-[#2C1810]">
      <Sidebar active={active} onSelect={setActive} />
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-hidden">
          {active === "chat" && <ChatPane />}
          {active === "models" && <ModelsPane />}
          {active === "settings" && <SettingsPane />}
          {active === "about" && <AboutPane />}
        </div>
        <footer className="border-t border-[#E8CFBB] p-3">
          <SidecarIndicator />
        </footer>
      </main>
    </div>
  );
}
