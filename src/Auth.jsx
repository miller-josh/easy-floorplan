import { useState } from 'react';
import { supabase } from './supabaseClient';

export default function Auth({ onAuth }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        if (data.user && !data.session) {
          setMessage('Check your email for a confirmation link, then sign in.');
          setIsSignUp(false);
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    onAuth(null); // null = offline/localStorage mode
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f1f5f9', fontFamily: "'DM Sans', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={{
        width: 380, background: '#fff', borderRadius: 16, padding: 32,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: '1px solid #e2e8f0',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🍕</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Floor Plan Tool</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            {isSignUp ? 'Create an account to sync designs across devices' : 'Sign in to access your saved designs'}
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = '#3B82F6'}
              onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#475569', display: 'block', marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="At least 6 characters"
              style={inputStyle}
              onFocus={(e) => e.target.style.borderColor = '#3B82F6'}
              onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
            />
          </div>

          {error && (
            <div style={{
              padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FEE2E2',
              borderRadius: 8, fontSize: 12, color: '#DC2626', marginBottom: 12,
            }}>{error}</div>
          )}

          {message && (
            <div style={{
              padding: '8px 12px', background: '#F0FDF4', border: '1px solid #DCFCE7',
              borderRadius: 8, fontSize: 12, color: '#16A34A', marginBottom: 12,
            }}>{message}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '10px 16px', background: '#3B82F6', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Please wait...' : (isSignUp ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError(null); setMessage(null); }}
            style={{
              background: 'none', border: 'none', color: '#3B82F6', fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>

        <div style={{
          marginTop: 20, paddingTop: 16, borderTop: '1px solid #e2e8f0', textAlign: 'center',
        }}>
          <button
            onClick={handleSkip}
            style={{
              background: 'none', border: 'none', color: '#94a3b8', fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Skip — use offline mode (localStorage only)
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
  background: '#f8fafc',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
