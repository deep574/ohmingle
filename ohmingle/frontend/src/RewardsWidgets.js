// RewardsWidgets.js
// Small UI pieces for the rewards system: the coin badge shown in the
// header, the "Share & Earn Coins" button + modal, and the toast used
// for streak/welcome/share/spin/session notifications.

import React, { useState } from 'react';
import { getReferralLink, awardShareBonus } from './rewards';

export function CoinBadge({ coins, isDark, T }) {
  return (
    <span
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: isDark ? '#1e293b' : '#f1f5f9',
        color: '#facc15', fontSize: 11, fontWeight: 800,
        padding: '3px 10px', borderRadius: 20,
        border: `1px solid ${T.headerBorder}`, whiteSpace: 'nowrap',
      }}
    >
      🪙 {coins}
    </span>
  );
}

export function ShareButton({ isDark, T, onShared }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const link = getReferralLink();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Fallback for browsers that block the Clipboard API
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    const { coinsAwarded, capped } = awardShareBonus();
    onShared?.({ coinsAwarded, capped });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'linear-gradient(135deg,#7c3aed,#a855f7)',
          color: '#fff', border: 'none', borderRadius: 20,
          padding: '5px 12px', fontSize: 11, fontWeight: 800,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          whiteSpace: 'nowrap',
        }}
      >
        🎁 Share & Earn
      </button>

      {open && (
        <div style={modalBg} onClick={() => setOpen(false)}>
          <div
            style={{ ...modal, background: isDark ? '#0f172a' : '#fff', border: `1px solid ${T.headerBorder}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ color: T.logo, margin: 0, fontSize: 18, fontWeight: 800, textAlign: 'center' }}>
              🎁 Share &amp; Earn Coins
            </h3>
            <p style={{ color: T.subText, fontSize: 13, textAlign: 'center', margin: '6px 0 14px' }}>
              Send this link to friends — you earn coins just for sharing it.
            </p>
            <div
              style={{
                background: isDark ? '#1e293b' : '#f1f5f9', borderRadius: 10,
                padding: '10px 12px', fontSize: 12, color: T.text,
                wordBreak: 'break-all', marginBottom: 12, border: `1px solid ${T.inputBorder}`,
              }}
            >
              {link}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                width: '100%', background: copied ? '#22c55e' : '#7c3aed',
                color: '#fff', border: 'none', borderRadius: 10, padding: '12px 0',
                fontSize: 14, fontWeight: 700, cursor: 'pointer', marginBottom: 8,
              }}
            >
              {copied ? '✅ Copied!' : '📋 Copy Link'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                width: '100%', background: 'transparent', color: T.subText,
                border: `1px solid ${T.inputBorder}`, borderRadius: 10, padding: 10,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function RewardToast({ toast }) {
  if (!toast) return null;
  return (
    <div style={toastWrap}>
      <span style={{ fontSize: 20 }}>{toast.icon || '🎉'}</span>
      <span style={{ fontWeight: 700, fontSize: 13 }}>{toast.text}</span>
    </div>
  );
}

const modalBg = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
};
const modal = { borderRadius: 18, padding: 22, width: 300, maxWidth: '90vw' };

const toastWrap = {
  position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
  background: '#1e293b', color: '#fff', padding: '10px 18px',
  borderRadius: 30, display: 'flex', alignItems: 'center', gap: 8,
  boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 9998,
  border: '1px solid #7c3aed',
  animation: 'toastIn 0.3s ease, toastOut 0.3s ease 2.7s',
  whiteSpace: 'nowrap',
};