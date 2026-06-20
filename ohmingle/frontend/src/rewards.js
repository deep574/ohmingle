// rewards.js
// ════════════════════════════════════════════════════════════════
// TODO: this uses localStorage as a placeholder — migrate to a real
// database (e.g. MongoDB/Postgres) before scaling, since localStorage
// doesn't sync across devices and can be cleared by the user.
//
// Specifically:
//  - Referral codes, coin balances, and streaks are all per-browser.
//    A user who switches devices or clears site data loses everything.
//  - We CANNOT credit a referrer when their friend signs up on a
//    different device/browser — there's no server-side ledger linking
//    "click" to "signup". Because of that, this file intentionally:
//      1) rewards the REFERRER for the act of sharing (capped/day),
//      2) rewards the NEW VISITOR with a one-time welcome bonus
//         when they arrive via ?ref=CODE,
//      3) does NOT attempt to track or pay out "successful" referrals.
//    Once you have a real backend, replace claimReferralWelcomeBonus()
//    with a call that also credits the referrer's account server-side.
// ════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';

const KEYS = {
  REFERRAL_CODE: 'ohm_referral_code',
  COINS: 'ohm_coins',
  LAST_VISIT_DATE: 'ohm_last_visit_date',
  STREAK: 'ohm_streak',
  WELCOME_BONUS_CLAIMED: 'ohm_welcome_bonus_claimed',
  REFERRED_BY: 'ohm_referred_by',
  SHARES_TODAY: 'ohm_shares_today',
  SHARES_TODAY_DATE: 'ohm_shares_today_date',
};

export const REWARDS = {
  DAILY_CHECKIN: 10,      // coins for first visit of a new calendar day
  WELCOME_BONUS: 20,      // coins for a new visitor arriving via ?ref=
  SHARE_BONUS: 5,         // coins per rewarded share
  SHARE_DAILY_CAP: 3,     // max rewarded shares per day (prevents farming)
  SESSION_CHAT_EVERY: 3,  // award a bonus every N chats in one session
  SESSION_CHAT_BONUS: 15,
};

const COINS_EVENT = 'ohm-coins-changed';

function todayStr() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// Simple calendar-day diff. Not timezone-perfect (a trip across
// timezones near midnight could shift this by a day), but good
// enough for a cosmetic streak counter.
function daysBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.round(ms / 86400000);
}

/* ── Referral code ───────────────────────────────────────────── */
export function getOrCreateReferralCode() {
  let code = localStorage.getItem(KEYS.REFERRAL_CODE);
  if (!code) {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
    localStorage.setItem(KEYS.REFERRAL_CODE, code);
  }
  return code;
}

export function getReferralLink() {
  const code = getOrCreateReferralCode();
  // window.location.origin keeps this correct in dev/staging/prod
  // (it'll read as ohmingle.vercel.app/?ref=ABC123 once deployed there).
  const origin = window.location.origin.replace(/\/$/, '');
  return `${origin}/?ref=${code}`;
}

/* ── Coins ────────────────────────────────────────────────────── */
export function getCoins() {
  return parseInt(localStorage.getItem(KEYS.COINS) || '0', 10);
}

function writeCoins(value) {
  localStorage.setItem(KEYS.COINS, String(value));
  // Notify any mounted React components in THIS tab (storage events
  // only fire in OTHER tabs, not the one that made the change).
  window.dispatchEvent(new CustomEvent(COINS_EVENT, { detail: value }));
}

export function addCoins(amount) {
  const next = getCoins() + amount;
  writeCoins(next);
  return next;
}

// Keeps a component's coin count live, even when a totally different
// component (ShareButton, SpinWheel, daily check-in, etc.) is the one
// that actually changed the balance.
export function useCoins() {
  const [coins, setCoins] = useState(getCoins);

  useEffect(() => {
    const onLocalChange = (e) => setCoins(e.detail);
    const onOtherTabChange = (e) => {
      if (e.key === KEYS.COINS) setCoins(parseInt(e.newValue || '0', 10));
    };
    window.addEventListener(COINS_EVENT, onLocalChange);
    window.addEventListener('storage', onOtherTabChange);
    return () => {
      window.removeEventListener(COINS_EVENT, onLocalChange);
      window.removeEventListener('storage', onOtherTabChange);
    };
  }, []);

  return coins;
}

/* ── Daily check-in / streak ─────────────────────────────────────
   Call once per app load. Returns { streak, coinsAwarded } if a NEW
   calendar-day check-in just happened, otherwise null. */
export function runDailyCheckIn() {
  const today = todayStr();
  const lastVisit = localStorage.getItem(KEYS.LAST_VISIT_DATE);

  if (lastVisit === today) return null; // already checked in today

  let streak = parseInt(localStorage.getItem(KEYS.STREAK) || '0', 10);

  if (lastVisit && daysBetween(lastVisit, today) === 1) {
    streak += 1; // came back on the very next calendar day
  } else {
    streak = 1; // first visit ever, or the streak was broken
  }

  localStorage.setItem(KEYS.LAST_VISIT_DATE, today);
  localStorage.setItem(KEYS.STREAK, String(streak));

  const coinsAwarded = REWARDS.DAILY_CHECKIN;
  addCoins(coinsAwarded);

  return { streak, coinsAwarded };
}

/* ── Referral welcome bonus (new-visitor side only) ──────────────
   See the file-level comment for why we don't try to credit the
   referrer here. Returns { coinsAwarded, ref } once, ever, per
   browser — or null if there's no ?ref=, it's already been claimed,
   or someone tried to "refer" themselves. */
export function claimReferralWelcomeBonus() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (!ref) return null;

  if (localStorage.getItem(KEYS.WELCOME_BONUS_CLAIMED)) return null;

  const myOwnCode = localStorage.getItem(KEYS.REFERRAL_CODE);
  if (myOwnCode && myOwnCode === ref) return null; // no self-referrals

  localStorage.setItem(KEYS.WELCOME_BONUS_CLAIMED, 'true');
  localStorage.setItem(KEYS.REFERRED_BY, ref);
  addCoins(REWARDS.WELCOME_BONUS);

  return { coinsAwarded: REWARDS.WELCOME_BONUS, ref };
}

/* ── Sharing ──────────────────────────────────────────────────────
   Rewards the act of sharing, capped per day so the button can't be
   spam-clicked for infinite coins. Always returns a result; check
   `capped` to know whether coins were actually awarded. */
export function awardShareBonus() {
  const today = todayStr();
  const lastDate = localStorage.getItem(KEYS.SHARES_TODAY_DATE);
  let count = lastDate === today
    ? parseInt(localStorage.getItem(KEYS.SHARES_TODAY) || '0', 10)
    : 0;

  if (count >= REWARDS.SHARE_DAILY_CAP) {
    return { coinsAwarded: 0, capped: true };
  }

  count += 1;
  localStorage.setItem(KEYS.SHARES_TODAY, String(count));
  localStorage.setItem(KEYS.SHARES_TODAY_DATE, today);
  addCoins(REWARDS.SHARE_BONUS);

  return { coinsAwarded: REWARDS.SHARE_BONUS, capped: false };
}

/* ── Session chat bonus ───────────────────────────────────────────
   chatsThisSession is intentionally kept in React state, NOT
   localStorage — it's meant to reward activity during the current
   visit only. (ohmingle_count in ChatPage.js already tracks the
   all-time "X strangers met" total separately.)
   Returns the coin amount awarded (0 if no bonus this time). */
export function checkSessionChatBonus(chatsThisSession) {
  if (chatsThisSession > 0 && chatsThisSession % REWARDS.SESSION_CHAT_EVERY === 0) {
    addCoins(REWARDS.SESSION_CHAT_BONUS);
    return REWARDS.SESSION_CHAT_BONUS;
  }
  return 0;
}