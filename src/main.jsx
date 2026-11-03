import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider, useUser, useClerk, useAuth } from "@clerk/clerk-react";
import FloorPlanTool from "./FloorPlanTool";
import Auth from "./Auth";
import Migrate from "./Migrate";
import BoardRoutes, { parseBoardHash, rememberInvite, pendingInvite } from "./board/BoardRoutes";
import { useClerkSupabaseClient, isSupabaseConfigured } from "./supabaseClient";

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Tracks the hash route: #migrate, #board[/<planId>], #invite/<token>
const pageFromHash = () => {
  const h = typeof window !== "undefined" ? window.location.hash : "";
  if (h === "#migrate") return "migrate";
  return parseBoardHash(h) ? "board" : "app";
};
if (typeof window !== "undefined") rememberInvite(window.location.hash);
function useHashPage() {
  const [page, setPage] = useState(pageFromHash);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [page, setPage];
}

function Loading() {
  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🍕</div>
        <div style={{ fontSize: 14, color: "#94a3b8" }}>Loading…</div>
      </div>
    </div>
  );
}

// Renders the actual tool / migrate page given resolved auth + client
function Shell({ supabase, user, offlineMode, onSignOut, getToken }) {
  const [page, setPage] = useHashPage();
  if (page === "board" || (!offlineMode && user && pendingInvite() && page === "app")) {
    // A pending invite survives the sign-in screen even if it dropped the hash.
    const route = parseBoardHash(window.location.hash) || { kind: "invite", token: pendingInvite() };
    return <BoardRoutes route={route} getToken={getToken} offlineMode={offlineMode} />;
  }
  if (page === "migrate") {
    return (
      <Migrate
        supabase={supabase}
        userId={user?.id}
        offlineMode={offlineMode}
        onDone={() => { window.location.hash = ""; setPage("app"); }}
      />
    );
  }
  return <FloorPlanTool supabase={supabase} user={user} offlineMode={offlineMode} onSignOut={onSignOut} />;
}

// Inside ClerkProvider: resolves Clerk session and the Clerk-bound Supabase client
function ClerkApp() {
  const { isLoaded, isSignedIn, user } = useUser();
  const supabase = useClerkSupabaseClient();
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const [offline, setOffline] = useState(false);

  if (!isLoaded) return <Loading />;
  if (!isSignedIn && !offline) return <Auth onSkip={() => setOffline(true)} />;

  const useOffline = offline || !isSignedIn;
  return (
    <Shell
      supabase={useOffline ? null : supabase}
      user={useOffline ? null : user}
      offlineMode={useOffline}
      onSignOut={() => signOut()}
      getToken={getToken}
    />
  );
}

function App() {
  // No Clerk key configured -> run fully offline (localStorage only), no auth screen
  if (!CLERK_KEY) {
    if (isSupabaseConfigured()) {
      console.warn("Supabase is configured but Clerk is not. Cloud sync needs VITE_CLERK_PUBLISHABLE_KEY. Running offline.");
    }
    return <Shell supabase={null} user={null} offlineMode onSignOut={() => {}} />;
  }
  return (
    <ClerkProvider publishableKey={CLERK_KEY} afterSignOutUrl="/">
      <ClerkApp />
    </ClerkProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
