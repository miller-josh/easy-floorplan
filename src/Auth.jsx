import { SignIn } from "@clerk/clerk-react";

// Sign-in screen using Clerk's prebuilt component, with an offline-skip option.
export default function Auth({ onSkip }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 16, padding: 24, background: "#f1f5f9", fontFamily: "'DM Sans', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 34, marginBottom: 6 }}>🍕</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>Floor Plan Tool</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>Sign in to sync your designs across devices</div>
      </div>

      <SignIn
        appearance={{
          elements: {
            rootBox: { width: "100%" },
            card: { boxShadow: "0 4px 24px rgba(0,0,0,0.08)", border: "1px solid #e2e8f0" },
          },
          variables: { colorPrimary: "#3B82F6", fontFamily: "'DM Sans', sans-serif" },
        }}
      />

      <button
        onClick={onSkip}
        style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 12, cursor: "pointer", fontFamily: "inherit", marginTop: 4 }}
      >
        Skip — use offline mode (localStorage only)
      </button>
    </div>
  );
}
