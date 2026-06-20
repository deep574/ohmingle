/* eslint-disable */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

const BACKEND_URL = 'https://ohmingle-backend-production-ff22.up.railway.app';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const DARK  = { page:'#0a0a0f', header:'#0a0a0f', headerBorder:'#1e293b', logo:'#fff', chat:'#0f172a', chatBorder:'#1e293b', bubble:'#1e293b', input:'#0f172a', inputBorder:'#2d3748', text:'#e2e8f0', subText:'#94a3b8', hint:'#475569', bar:'#060608', barBorder:'#1e293b', sysMsg:'#a855f7' };
const LIGHT = { page:'#f1f5f9', header:'#ffffff', headerBorder:'#e2e8f0', logo:'#0f172a', chat:'#ffffff', chatBorder:'#e2e8f0', bubble:'#e2e8f0', input:'#f8fafc', inputBorder:'#cbd5e1', text:'#0f172a', subText:'#64748b', hint:'#94a3b8', bar:'#ffffff', barBorder:'#e2e8f0', sysMsg:'#7c3aed' };

function countryToFlag(code) {
  return code.toUpperCase().split('').map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
}

export default function ChatPage() {
  const navigate = useNavigate();

  const [status,           setStatus]           = useState('idle');
  const [messages,         setMessages]         = useState([]);
  const [inputMsg,         setInputMsg]         = useState('');
  const [onlineCount,      setOnlineCount]      = useState(0);
  const [showReport,       setShowReport]       = useState(false);
  const [isMobile,         setIsMobile]         = useState(false);
  const [isDark,           setIsDark]           = useState(() => localStorage.getItem('ohmingle_theme') !== 'light');
  const [strangerCount,    setStrangerCount]    = useState(() => parseInt(localStorage.getItem('ohmingle_count') || '0'));
  const [myFlag,           setMyFlag]           = useState('🌍');
  const [strangerTyping,   setStrangerTyping]   = useState(false);
  const [interests]                             = useState(() => JSON.parse(localStorage.getItem('ohmingle_interests') || '[]'));
  const [matchedInterests, setMatchedInterests] = useState([]);
  const [blackWarn,        setBlackWarn]        = useState(0);
  const [connQuality,      setConnQuality]      = useState('');

  // ── Refs ────────────────────────────────────────────
  const localVideoRef    = useRef(null);
  const remoteVideoRef   = useRef(null);

  // ✅ KEY FIX: Separate ref to hold the remote MediaStream
  // This lives independently of the video DOM element
  const remoteStreamRef  = useRef(null);

  const peerRef          = useRef(null);
  const streamRef        = useRef(null);
  const socketRef        = useRef(null);
  const statusRef        = useRef('idle');
  const messagesEndRef   = useRef(null);
  const inputRef         = useRef(null);
  const typingTimeoutRef = useRef(null);
  const myTypingRef      = useRef(false);
  const myTypingTimeout  = useRef(null);
  const blackCountRef    = useRef(0);
  const blackIntervalRef = useRef(null);
  const blackWarnRef     = useRef(0);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { blackWarnRef.current = blackWarn; }, [blackWarn]);

  const T = isDark ? DARK : LIGHT;
  const toggleTheme = () => setIsDark(p => {
    const n = !p; localStorage.setItem('ohmingle_theme', n ? 'dark' : 'light'); return n;
  });

  useEffect(() => {
    const check = () => setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 1024);
    check(); window.addEventListener('resize', check); return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    fetch('https://ipapi.co/json/').then(r => r.json()).then(d => { if (d.country_code) setMyFlag(countryToFlag(d.country_code)); }).catch(() => {});
  }, []);

  // ── Black screen detection ───────────────────────────
  const checkBlackScreen = useCallback(() => {
    const video = remoteVideoRef.current;
    if (!video || statusRef.current !== 'connected') { blackCountRef.current = 0; return; }
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) { blackCountRef.current = 0; return; }
    try {
      const c = document.createElement('canvas'); c.width = 32; c.height = 24;
      const ctx = c.getContext('2d'); ctx.drawImage(video, 0, 0, 32, 24);
      const d = ctx.getImageData(0, 0, 32, 24).data;
      let t = 0; for (let i = 0; i < d.length; i += 4) t += (d[i] + d[i+1] + d[i+2]) / 3;
      const avg = t / (d.length / 4);
      if (avg < 12) {
        blackCountRef.current++;
        if (blackCountRef.current === 6  && blackWarnRef.current === 0) setBlackWarn(1);
        if (blackCountRef.current === 24 && blackWarnRef.current === 1) setBlackWarn(2);
      } else { blackCountRef.current = 0; if (blackWarnRef.current > 0) setBlackWarn(0); }
    } catch {}
  }, []);

  useEffect(() => {
    if (status === 'connected') { blackCountRef.current = 0; setBlackWarn(0); blackIntervalRef.current = setInterval(checkBlackScreen, 500); }
    else { clearInterval(blackIntervalRef.current); setBlackWarn(0); blackCountRef.current = 0; }
    return () => clearInterval(blackIntervalRef.current);
  }, [status, checkBlackScreen]);

  // ── Camera (once) ────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        streamRef.current = stream;
        if (localVideoRef.current) { localVideoRef.current.srcObject = stream; localVideoRef.current.play().catch(() => {}); }
      })
      .catch(() => alert('Please allow camera & microphone!'));
  }, []);

  const setLocalVideoRef = useCallback(el => {
    localVideoRef.current = el;
    if (el && streamRef.current) { el.srcObject = streamRef.current; el.play().catch(() => {}); }
  }, []);

  // ✅ KEY FIX: After EVERY render, re-check that the remote video element
  // has the correct stream attached. This handles all race conditions:
  // - ontrack fires before video element exists
  // - Re-renders that create new DOM elements
  // - ICE connection state changes
  useEffect(() => {
    if (
      status === 'connected' &&
      remoteVideoRef.current &&
      remoteStreamRef.current &&
      remoteStreamRef.current.getTracks().length > 0
    ) {
      if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
        console.log('🔄 Re-syncing remote stream to video element');
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
        remoteVideoRef.current.play().catch(() => {});
      }
    }
  }); // ← intentionally no deps = runs after every render

  // ── Socket (once) ────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'], forceNew: true });
    socketRef.current = socket;

    socket.on('connect', () => console.log('✅ Socket connected:', socket.id));
    socket.on('onlineCount', n => setOnlineCount(n));
    socket.on('waiting', () => setStatus('waiting'));

    socket.on('strangerFound', async ({ role, commonInterests }) => {
      if (statusRef.current === 'connected') { console.warn('🔒 Ignoring duplicate strangerFound'); return; }
      setStatus('connected'); statusRef.current = 'connected';
      setMessages([{ text: "✨ You're now chatting with someone new!", system: true }]);
      setStrangerCount(prev => { const n = prev + 1; localStorage.setItem('ohmingle_count', String(n)); return n; });
      setMatchedInterests(commonInterests?.length > 0 ? commonInterests : []);
      setConnQuality('');
      setTimeout(() => inputRef.current?.focus(), 200);
      if (role === 'caller') {
        const pc = makePeer(socket);
        try { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('offer', offer); }
        catch (e) { console.error('Offer error:', e); }
      }
    });

    socket.on('offer', async offer => {
      if (peerRef.current?.connectionState === 'connected') return;
      const pc = makePeer(socket);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', answer);
      } catch (e) { console.error('Answer error:', e); }
    });

    socket.on('answer', async answer => {
      if (peerRef.current) try { await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer)); } catch (e) { console.error(e); }
    });

    socket.on('iceCandidate', async c => {
      if (peerRef.current) try { await peerRef.current.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    });

    socket.on('message', data => setMessages(prev => [...prev, { text: data.text, from: 'stranger' }]));

    socket.on('strangerLeft', () => {
      setStatus('strangerLeft'); statusRef.current = 'strangerLeft';
      closePeer(); setMatchedInterests([]); setStrangerTyping(false); setConnQuality('');
      setMessages(prev => [...prev, { text: '👋 Stranger disconnected.', system: true }]);
    });

    socket.on('typing', () => {
      setStrangerTyping(true); clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setStrangerTyping(false), 2000);
    });

    return () => {
      socket.disconnect(); closePeer();
      clearTimeout(typingTimeoutRef.current); clearInterval(blackIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── WebRTC peer ──────────────────────────────────────
  function makePeer(socket) {
    closePeer();

    // ✅ KEY FIX: Create a fresh MediaStream ONCE per connection.
    // Tracks will be added to this stream as they arrive via ontrack.
    // This stream persists even if the video DOM element re-renders.
    remoteStreamRef.current = new MediaStream();

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 });

    if (streamRef.current)
      streamRef.current.getTracks().forEach(t => pc.addTrack(t, streamRef.current));

    // ✅ KEY FIX: ontrack handler
    // Problem 1: e.streams[0] can be undefined in some browsers → we handle both cases
    // Problem 2: tracks arrive one by one (video then audio) → we add each one
    pc.ontrack = e => {
      console.log('📹 ontrack fired:', e.track.kind, 'readyState:', e.track.readyState);

      const track = e.track;

      // ✅ FIX: Handle both cases — stream provided OR just a bare track
      if (e.streams && e.streams[0]) {
        // Normal case: attach the stream's tracks to our persistent stream
        e.streams[0].getTracks().forEach(t => {
          if (!remoteStreamRef.current.getTracks().find(x => x.id === t.id)) {
            remoteStreamRef.current.addTrack(t);
            console.log('➕ Added track from stream:', t.kind);
          }
        });
      } else {
        // Fallback: bare track, add it directly
        if (!remoteStreamRef.current.getTracks().find(x => x.id === track.id)) {
          remoteStreamRef.current.addTrack(track);
          console.log('➕ Added bare track:', track.kind);
        }
      }

      // ✅ FIX: Attach stream to video immediately
      const attachStream = () => {
        if (remoteVideoRef.current && remoteStreamRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
          remoteVideoRef.current.play().catch(err => console.log('play() error:', err));
          console.log('✅ Stream attached to video element');
        } else {
          console.warn('⚠️ Video element not ready, will retry...');
        }
      };

      attachStream();
      // Retry after short delay in case video element isn't mounted yet
      setTimeout(attachStream, 300);
      setTimeout(attachStream, 1000);
    };

    pc.onicecandidate = e => {
      if (e.candidate) {
        console.log('🧊 ICE candidate:', e.candidate.type);
        socket.emit('iceCandidate', e.candidate);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('🧊 ICE state:', state);

      if (state === 'connected' || state === 'completed') {
        setConnQuality('');
        // ✅ Re-attach stream when ICE connects (stream might have arrived before ICE was ready)
        if (remoteVideoRef.current && remoteStreamRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
          remoteVideoRef.current.play().catch(() => {});
          console.log('✅ Stream re-attached on ICE connected');
        }
      }
      if (state === 'disconnected') {
        setConnQuality('⚠️ Connection unstable');
        // Attempt recovery after 3 seconds
        setTimeout(() => {
          if (peerRef.current?.iceConnectionState === 'disconnected') {
            console.log('🔄 Attempting ICE restart...');
            peerRef.current.restartIce();
          }
        }, 3000);
      }
      if (state === 'failed') {
        setConnQuality('❌ Reconnecting...');
        peerRef.current?.restartIce();
      }
    };

    pc.onconnectionstatechange = () => console.log('🔗 Peer state:', pc.connectionState);

    peerRef.current = pc;
    return pc;
  }

  function closePeer() {
    if (peerRef.current) {
      peerRef.current.ontrack = null;
      peerRef.current.onicecandidate = null;
      peerRef.current.oniceconnectionstatechange = null;
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.close();
      peerRef.current = null;
    }
    // ✅ Clear the remote stream
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(t => t.stop());
      remoteStreamRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }

  // ── Actions ──────────────────────────────────────────
  const findStranger = () => {
    closePeer(); setMessages([]); setMatchedInterests([]); setStrangerTyping(false); setConnQuality('');
    setStatus('searching'); statusRef.current = 'searching';
    socketRef.current?.emit('findStranger', { interests });
  };

  const skipStranger = () => {
    socketRef.current?.emit('skip'); closePeer();
    setMessages([]); setMatchedInterests([]); setStrangerTyping(false); setConnQuality('');
    setStatus('searching'); statusRef.current = 'searching';
    setTimeout(() => socketRef.current?.emit('findStranger', { interests }), 500);
  };

  const sendMessage = () => {
    const text = inputMsg.trim(); if (!text) return;
    if (statusRef.current !== 'connected') { alert('Find a stranger first!'); return; }
    socketRef.current?.emit('message', { text });
    setMessages(prev => [...prev, { text, from: 'me' }]);
    setInputMsg(''); clearTimeout(myTypingTimeout.current); myTypingRef.current = false;
  };

  const handleInputChange = e => {
    setInputMsg(e.target.value);
    if (statusRef.current !== 'connected') return;
    if (!myTypingRef.current) { myTypingRef.current = true; socketRef.current?.emit('typing'); }
    clearTimeout(myTypingTimeout.current);
    myTypingTimeout.current = setTimeout(() => { myTypingRef.current = false; }, 1000);
  };

  const sendReaction = emoji => {
    if (statusRef.current !== 'connected') return;
    socketRef.current?.emit('message', { text: emoji });
    setMessages(prev => [...prev, { text: emoji, from: 'me' }]);
  };

  const reportStranger = reason => {
    alert(`✅ Reported: "${reason}". Thank you!`); setShowReport(false); skipStranger();
  };

  const goHome = () => {
    closePeer(); streamRef.current?.getTracks().forEach(t => t.stop()); navigate('/');
  };

  const isIdle      = status === 'idle' || status === 'strangerLeft';
  const isSearching = status === 'searching' || status === 'waiting';
  const pipStyle    = isMobile ? s.mobPip : s.deskPip;

  // ── JSX pieces (variables, NOT inner components — avoids ref unmount bug) ──

  const reportModal = showReport && (
    <div style={s.modalBg}>
      <div style={{...s.modal, background:isDark?'#0f172a':'#fff', border:`1px solid ${T.headerBorder}`}}>
        <h3 style={{...s.modalH, color:T.logo}}>🚩 Report Stranger</h3>
        <p style={{...s.modalSub, color:T.subText}}>Why are you reporting?</p>
        {['🔞 Nudity/Sexual Content','😠 Harassment','🤖 Spam/Bot','👶 Underage','⚠️ Other'].map(r => (
          <button type="button" key={r} style={{...s.modalOpt, background:T.bubble, color:T.text, border:`1px solid ${T.inputBorder}`}} onClick={() => reportStranger(r)}>{r}</button>
        ))}
        <button type="button" style={{...s.modalCancel, color:T.subText, border:`1px solid ${T.inputBorder}`}} onClick={() => setShowReport(false)}>Cancel</button>
      </div>
    </div>
  );

  const blackWarnModal = blackWarn > 0 && (
    <div style={s.modalBg}>
      <div style={{...s.modal, background:isDark?'#0f172a':'#fff', border:'1px solid #f97316', maxWidth:320}}>
        <span style={{fontSize:36, textAlign:'center', display:'block'}}>{blackWarn===1?'📷':'⚠️'}</span>
        <h3 style={{color:'#f97316', fontSize:17, fontWeight:800, textAlign:'center', margin:'8px 0 4px'}}>
          {blackWarn===1?'Camera Not Detected':'Camera Still Unavailable'}
        </h3>
        <p style={{color:T.subText, fontSize:13, textAlign:'center', margin:'0 0 12px', lineHeight:1.5}}>
          {blackWarn===1?"The stranger's camera feed appears black or unavailable.":"The stranger's camera is still not working."}
        </p>
        <div style={{display:'flex', gap:8, flexDirection:'column'}}>
          <button type="button" style={{...s.modalOpt, background:'#7c3aed', color:'#fff', border:'none', textAlign:'center', fontWeight:700}} onClick={() => { setBlackWarn(0); blackCountRef.current = 0; }}>Continue Anyway</button>
          <button type="button" style={{...s.modalOpt, background:'#ef4444', color:'#fff', border:'none', textAlign:'center', fontWeight:700}} onClick={() => { setBlackWarn(0); skipStranger(); }}>Skip This Person</button>
        </div>
      </div>
    </div>
  );

  const videoOverlay = status !== 'connected' && (
    <div style={s.overlay}>
      {status === 'idle' && <p style={s.ovBig}>👋 {isMobile?'Tap':'Click'} Start!</p>}
      {isSearching && (<><div style={s.spinner}/><p style={s.ovBig}>Finding stranger...</p><p style={s.ovSub}>This takes a few seconds</p></>)}
      {status === 'strangerLeft' && (<><p style={s.ovBig}>👋 Stranger left!</p><p style={s.ovSub}>Click Next to find someone new</p></>)}
    </div>
  );

  const interestBar = matchedInterests.length > 0 && (
    <div style={{position:'absolute', top:10, left:10, right:isMobile?100:170, display:'flex', gap:6, flexWrap:'wrap', zIndex:15}}>
      <span style={{color:'#fff', fontSize:11, fontWeight:700, background:'rgba(124,58,237,0.85)', padding:'3px 8px', borderRadius:10}}>✨ Both like:</span>
      {matchedInterests.map(i => <span key={i} style={{background:'rgba(34,197,94,0.85)', color:'#fff', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:10}}>{i}</span>)}
    </div>
  );

  const messagesContent = (
    <>
      {messages.length === 0 && (
        <p style={{...s.hint, color:T.hint}}>
          {status==='idle'?'👇 Click Start to find someone':isSearching?'🔍 Searching...':status==='connected'?'👋 Say hello!':'Stranger left. Click Next!'}
        </p>
      )}
      {messages.map((msg, i) =>
        msg.system
          ? <p key={i} style={{...s.sysMsg, color:T.sysMsg}}>{msg.text}</p>
          : <div key={i} style={{...s.bubble, alignSelf:msg.from==='me'?'flex-end':'flex-start', background:msg.from==='me'?'#7c3aed':T.bubble, color:msg.from==='me'?'#fff':T.text}}>
              <span style={{...s.bName, color:msg.from==='me'?'rgba(255,255,255,0.5)':T.subText}}>{msg.from==='me'?'You':'Stranger'}</span>
              {msg.text}
            </div>
      )}
      {strangerTyping && (
        <div style={{display:'flex', alignItems:'center', gap:6, padding:'4px 0'}}>
          <span style={{color:T.subText, fontSize:12, fontStyle:'italic'}}>Stranger is typing</span>
          <span style={{color:'#a855f7', fontSize:14, animation:'pulse 1s infinite'}}>●●●</span>
        </div>
      )}
      <div ref={messagesEndRef}/>
    </>
  );

  const controlsContent = (
    <>
      <div style={{display:'flex', gap:5, width:'100%', marginBottom:6}}>
        {['👍','❤️','😂','😮','🔥'].map(emoji => (
          <button type="button" key={emoji} onClick={() => sendReaction(emoji)} style={{background:isDark?'#1e293b':'#f1f5f9', border:`1px solid ${T.inputBorder}`, borderRadius:20, padding:'4px 0', fontSize:16, cursor:'pointer', flex:1, minWidth:0}}>{emoji}</button>
        ))}
      </div>
      <div style={{display:'flex', gap:8, width:'100%', alignItems:'center'}}>
        {isIdle
          ? <button type="button" style={s.nextBtn} onClick={findStranger}>▶▶ Start</button>
          : <button type="button" style={s.nextBtn} onClick={skipStranger}>▶▶ Next</button>}
        <button type="button" style={s.stopBtn} onClick={goHome}>■</button>
        <input
          ref={inputRef}
          style={{...s.input, background:T.input, border:`1px solid ${T.inputBorder}`, color:T.text}}
          type="text" placeholder="Type message..."
          value={inputMsg} onChange={handleInputChange}
          onKeyDown={e => { if(e.key==='Enter'){e.preventDefault();e.stopPropagation();sendMessage();} }}
        />
        <button type="button" style={s.sendBtn} onClick={sendMessage}>➤</button>
      </div>
      {connQuality && <div style={{fontSize:11, color: connQuality.includes('✅')?'#22c55e':'#f97316', textAlign:'center', width:'100%', marginTop:3}}>{connQuality}</div>}
    </>
  );

  const headerJsx = (
    <div style={{...s.header, background:T.header, borderBottom:`1px solid ${T.headerBorder}`}}>
      <div style={{display:'flex', alignItems:'center', gap:10}}>
        <span style={{...s.logo, color:T.logo}} onClick={goHome}>Ohm<span style={{color:'#a855f7'}}>ingle</span></span>
        <span style={{background:isDark?'#1e293b':'#f1f5f9', color:T.subText, fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:20, border:`1px solid ${T.headerBorder}`}}>👥 {strangerCount} met</span>
      </div>
      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <span style={{...s.online, color:T.subText}}><span style={s.dot}/>{onlineCount} online</span>
        <button type="button" onClick={toggleTheme} style={{background:'transparent', border:`1px solid ${T.headerBorder}`, borderRadius:20, padding:'4px 10px', fontSize:16, cursor:'pointer'}}>{isDark?'☀️':'🌙'}</button>
      </div>
    </div>
  );

  /* ══════════════════════════════════════════════════════
     VIDEO JSX — INLINED (not a function/component)
     This way the <video ref={remoteVideoRef}> DOM element is
     NEVER unmounted on re-renders — srcObject is preserved.
  ══════════════════════════════════════════════════════ */

  /* ── MOBILE ─────────────────────────────────────────── */
  if (isMobile) return (
    <div style={{...s.page, background:T.page}}>
      <style>{CSS}</style>
      {reportModal}{blackWarnModal}
      {headerJsx}

      {/* ✅ Video element directly inlined — ref stays stable across renders */}
      <div style={{...s.videoWrap, height:'47vh', flexShrink:0}}>
        <video ref={remoteVideoRef} autoPlay playsInline style={s.remoteVid}/>
        {videoOverlay}{interestBar}
        <div style={pipStyle}>
          <video ref={setLocalVideoRef} autoPlay playsInline muted style={s.pipVid}/>
          <span style={s.youTxt}>{myFlag} You</span>
        </div>
        <div style={s.vBottom}>
          <span style={s.brand}>Ohmingle.com</span>
          <button type="button" style={s.flagBtn} onClick={() => setShowReport(true)}>🚩</button>
        </div>
      </div>

      <div style={{...s.chatBox, background:T.chat, border:`1px solid ${T.chatBorder}`, margin:'8px 10px', flex:1}}>
        {messagesContent}
      </div>
      <div style={{padding:'8px 10px 12px', background:T.bar, borderTop:`1px solid ${T.barBorder}`, flexShrink:0}}>
        {controlsContent}
      </div>
    </div>
  );

  /* ── DESKTOP ─────────────────────────────────────────── */
  return (
    <div style={{...s.page, background:T.page}}>
      <style>{CSS}</style>
      {reportModal}{blackWarnModal}
      {headerJsx}
      <div style={s.deskBody}>
        <div style={s.deskLeft}>
          {/* ✅ Video element directly inlined — ref stays stable across renders */}
          <div style={{...s.videoWrap, width:'100%', height:'100%'}}>
            <video ref={remoteVideoRef} autoPlay playsInline style={s.remoteVid}/>
            {videoOverlay}{interestBar}
            <div style={pipStyle}>
              <video ref={setLocalVideoRef} autoPlay playsInline muted style={s.pipVid}/>
              <span style={s.youTxt}>{myFlag} You</span>
            </div>
            <div style={s.vBottom}>
              <span style={s.brand}>Ohmingle.com</span>
              <button type="button" style={s.flagBtn} onClick={() => setShowReport(true)}>🚩</button>
            </div>
          </div>
        </div>
        <div style={{...s.deskRight, background:T.chat}}>
          <div style={{...s.chatBox, border:'none', borderRadius:0, margin:0, flex:1}}>
            {messagesContent}
          </div>
        </div>
      </div>
      <div style={{padding:'10px 18px 12px', background:T.bar, borderTop:`1px solid ${T.barBorder}`, flexShrink:0}}>
        {controlsContent}
      </div>
    </div>
  );
}

const CSS = `
  @keyframes spin  { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  input::placeholder { color: #475569; }
  input:focus { border-color: #7c3aed !important; outline: none; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
  video { background: #111; display: block; }
`;

const s = {
  modalBg:     { position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 },
  modal:       { borderRadius:20, padding:24, width:300, display:'flex', flexDirection:'column', gap:10 },
  modalH:      { fontSize:18, fontWeight:800, textAlign:'center', margin:0 },
  modalSub:    { fontSize:13, textAlign:'center', margin:0 },
  modalOpt:    { borderRadius:10, padding:'12px 16px', fontSize:14, cursor:'pointer', textAlign:'left', border:'none' },
  modalCancel: { background:'transparent', borderRadius:10, padding:10, fontSize:13, cursor:'pointer', border:'none' },

  page:    { position:'fixed', inset:0, display:'flex', flexDirection:'column', fontFamily:'system-ui,sans-serif', overflow:'hidden' },
  header:  { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 16px', flexShrink:0 },
  logo:    { fontSize:24, fontWeight:900, cursor:'pointer', letterSpacing:-0.5 },
  online:  { display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600 },
  dot:     { width:8, height:8, background:'#22c55e', borderRadius:'50%', boxShadow:'0 0 6px #22c55e', display:'inline-block' },

  videoWrap: { position:'relative', background:'#000', overflow:'hidden' },
  remoteVid: { width:'100%', height:'100%', objectFit:'cover' },

  overlay: { position:'absolute', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, zIndex:5 },
  spinner: { width:50, height:50, border:'4px solid rgba(168,85,247,0.2)', borderTopColor:'#a855f7', borderRadius:'50%', animation:'spin 0.9s linear infinite' },
  ovBig:   { color:'#fff', fontSize:20, fontWeight:700, margin:0, textAlign:'center' },
  ovSub:   { color:'#94a3b8', fontSize:13, margin:0, textAlign:'center' },

  mobPip:  { position:'absolute', top:10, right:10, width:82,  height:110, borderRadius:10, overflow:'hidden', border:'2.5px solid #7c3aed', boxShadow:'0 0 18px rgba(124,58,237,0.7)', zIndex:20 },
  deskPip: { position:'absolute', top:14, right:14, width:152, height:203, borderRadius:12, overflow:'hidden', border:'2.5px solid #7c3aed', boxShadow:'0 0 24px rgba(124,58,237,0.7)', zIndex:20 },
  pipVid:  { width:'100%', height:'100%', objectFit:'cover', transform:'scaleX(-1)' },
  youTxt:  { position:'absolute', bottom:4, left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.75)', color:'#fff', fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:8, whiteSpace:'nowrap' },

  vBottom: { position:'absolute', bottom:0, left:0, right:0, display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 14px', background:'linear-gradient(transparent,rgba(0,0,0,0.65))', zIndex:10 },
  brand:   { color:'#a855f7', fontWeight:800, fontSize:13 },
  flagBtn: { background:'transparent', border:'none', fontSize:18, cursor:'pointer', padding:0 },

  chatBox: { flex:1, borderRadius:14, padding:'12px', overflowY:'auto', display:'flex', flexDirection:'column', gap:8, minHeight:0 },
  hint:    { fontSize:14, textAlign:'center', marginTop:20, lineHeight:1.6 },
  sysMsg:  { fontSize:12, textAlign:'center', fontStyle:'italic', margin:'3px 0' },
  bubble:  { padding:'9px 13px', borderRadius:14, maxWidth:'75%', fontSize:14, lineHeight:1.5, wordBreak:'break-word' },
  bName:   { fontSize:10, fontWeight:700, display:'block', marginBottom:3 },

  nextBtn: { background:'#22c55e', border:'none', borderRadius:12, padding:'0 16px', height:46, fontSize:14, fontWeight:700, color:'#fff', cursor:'pointer', flexShrink:0 },
  stopBtn: { background:'#ef4444', border:'none', borderRadius:12, width:46, height:46, fontSize:16, color:'#fff', cursor:'pointer', flexShrink:0 },
  input:   { flex:1, borderRadius:12, padding:'0 14px', height:46, fontSize:14, outline:'none', minWidth:0 },
  sendBtn: { background:'#7c3aed', border:'none', borderRadius:12, width:46, height:46, fontSize:18, color:'#fff', cursor:'pointer', flexShrink:0 },

  deskBody:  { flex:1, display:'flex', minHeight:0, overflow:'hidden' },
  deskLeft:  { flex:'0 0 66%', position:'relative', background:'#000', overflow:'hidden', borderRight:'1px solid #1e293b' },
  deskRight: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
};