// SpinWheel.js
// Purely cosmetic mini-game shown while status === 'searching' / 'waiting'.
// Its only job is to make the wait feel less dead and reduce bounce.
// Reward amounts are intentionally small and weighted toward the low end.

import React, { useState } from 'react';

const SEGMENTS = [
  { amount: 2,  color: '#7c3aed', weight: 22 },
  { amount: 10, color: '#22c55e', weight: 8  },
  { amount: 1,  color: '#ef4444', weight: 28 },
  { amount: 5,  color: '#f97316', weight: 18 },
  { amount: 1,  color: '#3b82f6', weight: 18 },
  { amount: 20, color: '#eab308', weight: 6  },
];

function pickWeightedIndex() {
  const total = SEGMENTS.reduce((sum, seg) => sum + seg.weight, 0);
  let r = Math.random() * total;
  for (let i = 0; i < SEGMENTS.length; i++) {
    r -= SEGMENTS[i].weight;
    if (r <= 0) return i;
  }
  return SEGMENTS.length - 1;
}

function buildGradient() {
  const segAngle = 360 / SEGMENTS.length;
  const stops = SEGMENTS.map((seg, i) => {
    const start = i * segAngle;
    const end = start + segAngle;
    return `${seg.color} ${start}deg ${end}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export default function SpinWheel({ onWin, disabled }) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);

  const spin = () => {
    if (spinning || disabled) return;
    setResult(null);
    setSpinning(true);

    const idx = pickWeightedIndex();
    const segAngle = 360 / SEGMENTS.length;
    // Angle (within one turn) needed to bring segment idx under the
    // top pointer, then add a few full spins for visual effect.
    const targetWithinTurn = 360 - (idx * segAngle + segAngle / 2);
    const extraSpins = 4 + Math.floor(Math.random() * 2);
    const delta = ((targetWithinTurn - (rotation % 360)) + 360) % 360;
    const finalRotation = rotation + extraSpins * 360 + delta;

    setRotation(finalRotation);

    setTimeout(() => {
      setSpinning(false);
      setResult(SEGMENTS[idx].amount);
      onWin(SEGMENTS[idx].amount);
    }, 3000); // keep in sync with the CSS transition duration below
  };

  return (
    <div style={wrap}>
      <div style={{ position: 'relative', width: 120, height: 120 }}>
        <div style={pointer} />
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: buildGradient(),
            border: '4px solid #fff',
            boxShadow: '0 0 20px rgba(124,58,237,0.55)',
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? 'transform 3s cubic-bezier(0.17,0.67,0.12,0.99)' : 'none',
          }}
        />
        <div style={hub}>🎯</div>
      </div>

      <button
        type="button"
        onClick={spin}
        disabled={spinning || disabled}
        style={{
          ...spinBtn,
          opacity: spinning || disabled ? 0.55 : 1,
          cursor: spinning || disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {spinning ? 'Spinning...' : disabled ? '✅ Already spun' : '🎡 Spin to win coins!'}
      </button>

      {result !== null && (
        <p style={resultTxt}>🎉 You won {result} coin{result === 1 ? '' : 's'}!</p>
      )}
    </div>
  );
}

const wrap = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  gap: 10, marginTop: 18, zIndex: 6, position: 'relative',
};
const pointer = {
  position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
  width: 0, height: 0,
  borderLeft: '7px solid transparent', borderRight: '7px solid transparent',
  borderBottom: '13px solid #fff', zIndex: 5,
};
const hub = {
  position: 'absolute', top: '50%', left: '50%',
  transform: 'translate(-50%,-50%)', fontSize: 18, zIndex: 4,
};
const spinBtn = {
  background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 20,
  padding: '9px 16px', fontSize: 13, fontWeight: 700,
};
const resultTxt = { color: '#facc15', fontWeight: 700, fontSize: 13, margin: 0 };