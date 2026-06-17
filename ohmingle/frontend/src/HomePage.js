import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function HomePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    setTimeout(() => setLoading(false), 2500);
    setOnlineCount(Math.floor(Math.random() * 500) + 100);
  }, []);

  const handleTagKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim().replace(/^#/, '');
      if (newTag && !tags.includes(newTag) && tags.length < 5) {
        setTags([...tags, newTag]);
      }
      setTagInput('');
    }
    if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  const removeTag = (tag) => setTags(tags.filter(t => t !== tag));

  const startChat = () => {
    if (!agreed) { alert('Please agree to terms first!'); return; }
    navigate('/chat', { state: { interests: tags.map(t => '#' + t) } });
  };

  if (loading) {
    return (
      <div style={loadStyles.container}>
        <div style={loadStyles.content}>
          <div style={loadStyles.logo}>
            Ohm<span style={{ color: '#7c3aed' }}>ingle</span>
          </div>
          <p style={loadStyles.tagline}>Real Conversations. Real People.</p>
          <div style={loadStyles.spinnerWrap}>
            <div style={loadStyles.spinner}></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>

      {/* Header */}
      <header style={s.header}>
        <div style={s.logo}>
          Ohm<span style={{ color: '#7c3aed' }}>ingle</span>
        </div>
        <div style={s.onlineCount}>
          <span style={s.onlineDot}></span>
          {onlineCount} online now
        </div>
      </header>

      {/* Hero */}
      <main style={s.hero}>

        {/* Big Title */}
        <div style={s.titleWrap}>
          <h1 style={s.title}>
            Meet Someone<br />
            <span style={s.titleAccent}>New Right Now</span>
          </h1>
          <p style={s.subtitle}>
            Instant video chat with real strangers worldwide.<br />No login. No drama. Just talk.
          </p>
        </div>

        {/* Card */}
        <div style={s.card}>

          {/* Hashtag Input */}
          <div style={s.inputSection}>
            <label style={s.inputLabel}>💬 What do you want to talk about?</label>
            <div style={s.tagBox}>
              {tags.map(tag => (
                <span key={tag} style={s.tag}>
                  #{tag}
                  <button style={s.tagRemove} onClick={() => removeTag(tag)}>×</button>
                </span>
              ))}
              <input
                style={s.tagInput}
                placeholder={tags.length === 0 ? 'Type a topic and press Enter… e.g. music' : ''}
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                maxLength={20}
              />
            </div>
            <p style={s.tagHint}>Press Enter to add • Max 5 tags</p>
          </div>

          {/* Divider */}
          <div style={s.divider} />

          {/* Terms */}
          <div style={s.termsBox}>
            <input
              type="checkbox"
              id="terms"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#7c3aed', flexShrink: 0 }}
            />
            <label htmlFor="terms" style={{ color: '#9ca3af', fontSize: '14px', cursor: 'pointer', lineHeight: 1.5 }}>
              I am 18+ and agree to the{' '}
              <span style={{ color: '#a78bfa', textDecoration: 'underline' }}>Terms of Service</span>
            </label>
          </div>

          {/* Start Button */}
          <button
            style={{
              ...s.startBtn,
              opacity: agreed ? 1 : 0.4,
              cursor: agreed ? 'pointer' : 'not-allowed',
              transform: agreed ? 'scale(1)' : 'scale(0.98)',
            }}
            onClick={startChat}
          >
            🎥 Start Chatting
          </button>

        </div>

        {/* Stats Row */}
        <div style={s.statsRow}>
          {[
            { val: '500K+', label: 'Users Monthly' },
            { val: '190+', label: 'Countries' },
            { val: '0', label: 'Sign-ups Needed' },
          ].map(stat => (
            <div key={stat.label} style={s.stat}>
              <span style={s.statVal}>{stat.val}</span>
              <span style={s.statLabel}>{stat.label}</span>
            </div>
          ))}
        </div>

        {/* Feature Pills */}
        <div style={s.pills}>
          {['🌍 Global', '🔒 Anonymous', '⚡ Instant', '🎥 HD Video', '💬 Text Chat'].map(p => (
            <span key={p} style={s.pill}>{p}</span>
          ))}
        </div>

      </main>

      {/* Footer */}
      <footer style={s.footer}>
        <p>© 2025 Ohmingle</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '6px' }}>
          {['Terms', 'Privacy', 'Contact'].map(link => (
            <span key={link} style={{ color: '#7c3aed', cursor: 'pointer', fontSize: '13px' }}>{link}</span>
          ))}
        </div>
      </footer>
    </div>
  );
}

// ─── LOADING STYLES ───────────────────────────────────────────────────────────
const loadStyles = {
  container: {
    height: '100vh',
    background: 'radial-gradient(ellipse at center, #1a0a2e 0%, #0a0a0f 70%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Segoe UI, sans-serif',
  },
  content: { textAlign: 'center' },
  logo: {
    fontSize: '72px', fontWeight: '900', color: 'white',
    marginBottom: '12px', letterSpacing: '-2px',
  },
  tagline: { fontSize: '18px', color: '#9ca3af', marginBottom: '48px' },
  spinnerWrap: { display: 'flex', justifyContent: 'center' },
  spinner: {
    width: '48px', height: '48px',
    border: '4px solid rgba(255,255,255,0.1)',
    borderTop: '4px solid #7c3aed',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
};

// ─── MAIN STYLES ──────────────────────────────────────────────────────────────
const s = {
  container: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    background: '#0a0a0f', color: 'white', fontFamily: 'Segoe UI, sans-serif',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '18px 40px',
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  logo: { fontSize: '26px', fontWeight: '900', color: 'white' },
  onlineCount: { display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: '600', fontSize: '14px' },
  onlineDot: {
    width: '8px', height: '8px', background: '#10b981', borderRadius: '50%',
    display: 'inline-block', boxShadow: '0 0 6px #10b981',
  },
  hero: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '56px 20px 40px',
    background: 'radial-gradient(ellipse at top, #150a2a 0%, #0a0a0f 55%)',
  },
  titleWrap: { textAlign: 'center', marginBottom: '40px' },
  title: {
    fontSize: '58px', fontWeight: '900', lineHeight: 1.1,
    marginBottom: '16px', letterSpacing: '-1px',
  },
  titleAccent: {
    background: 'linear-gradient(135deg, #7c3aed, #ec4899)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '17px', color: '#9ca3af', lineHeight: 1.7,
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: '24px',
    padding: '36px',
    width: '100%',
    maxWidth: '520px',
    marginBottom: '40px',
    backdropFilter: 'blur(10px)',
  },
  inputSection: { marginBottom: '24px' },
  inputLabel: {
    display: 'block', fontSize: '15px', fontWeight: '700',
    color: '#e5e7eb', marginBottom: '12px',
  },
  tagBox: {
    display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
    background: 'rgba(255,255,255,0.05)',
    border: '1.5px solid rgba(124,58,237,0.4)',
    borderRadius: '12px', padding: '10px 14px',
    minHeight: '52px', cursor: 'text',
  },
  tag: {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    background: 'rgba(124,58,237,0.25)',
    border: '1px solid rgba(124,58,237,0.5)',
    color: '#c4b5fd', borderRadius: '50px',
    padding: '4px 12px', fontSize: '13px', fontWeight: '600',
  },
  tagRemove: {
    background: 'none', border: 'none', color: '#a78bfa',
    cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0',
  },
  tagInput: {
    background: 'transparent', border: 'none', outline: 'none',
    color: 'white', fontSize: '14px', flex: 1, minWidth: '120px',
  },
  tagHint: { fontSize: '12px', color: '#6b7280', marginTop: '8px' },
  divider: {
    height: '1px', background: 'rgba(255,255,255,0.07)', margin: '20px 0',
  },
  termsBox: {
    display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '20px',
  },
  startBtn: {
    width: '100%', padding: '16px',
    fontSize: '18px', fontWeight: '800',
    background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
    color: 'white', border: 'none', borderRadius: '14px',
    boxShadow: '0 0 30px rgba(124,58,237,0.4)',
    transition: 'all 0.2s ease', letterSpacing: '0.02em',
  },
  statsRow: {
    display: 'flex', gap: '40px', marginBottom: '32px',
    justifyContent: 'center',
  },
  stat: { textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '4px' },
  statVal: { fontSize: '26px', fontWeight: '900', color: 'white' },
  statLabel: { fontSize: '12px', color: '#6b7280', fontWeight: '500' },
  pills: { display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' },
  pill: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '50px', padding: '7px 16px',
    fontSize: '13px', color: '#9ca3af', fontWeight: '500',
  },
  footer: {
    padding: '24px', textAlign: 'center', color: '#6b7280', fontSize: '13px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
};

export default HomePage;