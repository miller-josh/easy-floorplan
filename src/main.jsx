import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import FloorPlanTool from './FloorPlanTool';
import Auth from './Auth';
import Migrate from './Migrate';
import { supabase, isSupabaseConfigured } from './supabaseClient';

function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [offlineMode, setOfflineMode] = useState(false);
  const [page, setPage] = useState('app'); // 'app' | 'migrate'

  // Check hash for #migrate route
  useEffect(() => {
    const checkHash = () => {
      if (window.location.hash === '#migrate') setPage('migrate');
      else setPage('app');
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setOfflineMode(true);
      setSession(null);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Loading
  if (session === undefined && !offlineMode) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', fontFamily: "'DM Sans', sans-serif" }}>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🍕</div>
          <div style={{ fontSize: 14, color: '#94a3b8' }}>Loading...</div>
        </div>
      </div>
    );
  }

  // Migration page
  if (page === 'migrate') {
    if (!session && !offlineMode && isSupabaseConfigured()) {
      return <Auth onAuth={(mode) => { if (mode === null) setOfflineMode(true); }} />;
    }
    return (
      <Migrate
        session={session}
        onDone={() => {
          window.location.hash = '';
          setPage('app');
        }}
      />
    );
  }

  // Auth screen
  if (!session && !offlineMode && isSupabaseConfigured()) {
    return <Auth onAuth={(mode) => { if (mode === null) setOfflineMode(true); }} />;
  }

  // Main app
  return (
    <FloorPlanTool
      session={session}
      offlineMode={offlineMode}
      onSignOut={async () => {
        if (supabase) await supabase.auth.signOut();
        setSession(null);
        setOfflineMode(false);
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
