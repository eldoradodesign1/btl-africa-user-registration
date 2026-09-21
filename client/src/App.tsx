import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import AdminDashboard from "./pages/AdminDashboard";
import Home from "./pages/Home";
import { isSupabaseConfigured } from "@/lib/supabase";

export default function App() {
  const [view, setView] = useState<"create" | "dashboard">(isSupabaseConfigured() ? "dashboard" : "create");
  const [connectionVersion, setConnectionVersion] = useState(0);

  function handleConnectionChanged() {
    setConnectionVersion((value) => value + 1);
  }

  return view === "dashboard" ? (
    <div className="app-shell dashboard-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">BTL</div><div><span className="brand-name">BTL Africa</span><span className="brand-context">Privilege Tracker · Administration</span></div></div>
        <div className="topbar-actions"><span className="admin-entry-label"><ShieldCheck size={13} /> Accès sécurisé</span></div>
      </header>
      <main className="page-content dashboard-page"><AdminDashboard onConnectionChanged={handleConnectionChanged} onRequestCreate={() => setView("create")} /></main>
    </div>
  ) : (
    <Home key={connectionVersion} onNavigateDashboard={() => setView("dashboard")} />
  );
}
