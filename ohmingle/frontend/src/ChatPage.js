import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

const BACKEND_URL = 'https://ohmingle-backend-production-ff22.up.railway.app';

// ── THEMES ────────────────────────────────────────────────────────────────────
const DARK = {
  page:'#0a0a0f', header:'#0a0a0f', headerBorder:'#1e293b',
  logo:'#fff', chat:'#0f172a', chatBorder:'#1e293b',
  bubble:'#1e293b', input:'#0f172a', inputBorder:'#1e293b',
  text:'#e2e8f0', subText:'#94a3b8', hint:'#475569',
  bar:'#060608', barBorder:'#1e293b', sysMsg:'#7c3aed',
};
const LIGHT = {
  page:'#f1f5f9', header:'#ffffff', headerBorder:'#e2e8f0',
  logo:'#0f172a', chat:'#ffffff', chatBorder:'#e2e8f0',
  bubble:'#e2e8f0', input:'#f8fafc', inputBorder:'#cbd5e1',
  text:'#0f172a', subText:'#64748b', hint:'#94a3b8',
  bar:'#ffffff', barBorder:'#e2e8f0', sysMsg:'#7c3aed',
};

function ChatPage() {
  const navigate = useNavigate();

  // ── EXISTING state ─────────────────────────────────────────────────────────
  const [status, setStatus]           = useState('idle');
  const [messages, setMessages]       = useState([]);
  const [inputMsg, setInputMsg]       = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [showReport, setShowReport]   = useState(false);
  const [isMobile, setIsMobile]       = useState(window.innerWidth < 1024);

  // ── FEATURE 1: Stranger counter ────────────────────────────────────────────
  const [strangerCount, setStrangerCount] = useState(
    () => parseInt(localStorage.getItem('ohmingle_count') || '0')
  );

  // ── FEATURE 2: Theme toggle ────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(
    () => localStorage.getItem('ohmingle_theme') !== 'light'
  );
  const T = isDark ? DARK : LIGHT; // current theme colors

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      localStorage.setItem('ohmingle_theme', next ? 'dark' : 'light');
      return next;
    });
  };

  // ── FEATURE 3: Country flag ────────────────────────────────────────────────
  const [myFlag, setMyFlag] = useState('🌍');

  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(d => { if (d.country_code) setMyFlag(countryToFlag(d.country_code)); })
      .catch(() => {}); // silent fail
  }, []);

  // ── FEATURE 5: Typing indicator ────────────────────────────────────────────
  const [strangerTyping, setStrangerTyping] = useState(false);
  const typingTimeoutRef = useRef(null);
  const myTypingRef      = useRef(false);
  const myTypingTimeout  = useRef(null);

  // ── FEATURE 6: Safe mode ───────────────────────────────────────────────────
  const [safeMode, setSafeMode] = useState(true);
  const [safeTimer, setSafeTimer] = useState(false);
  const safeTimerRef = useRef(null);

  // ── FEATURE 7: Interest tags ───────────────────────────────────────────────
  const [interests, setInterests] = useState(
    () => JSON.parse(localStorage.getItem('ohmingle_interests') || '[]')
  );
  const [matchedInterests, setMatchedInterests] = useState([]);

  // ── EXISTING refs ──────────────────────────────────────────────────────────
  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef        = useRef(null);
  const streamRef      = useRef(null);
  const socketRef      = useRef(null);
  const statusRef      = useRef('idle');
  const messagesEndRef = useRef(null);

  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // ── EXISTING: Camera starts once ──────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        streamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
      })
      .catch(() => alert('Please allow camera & microphone!'));
  }, []);

  const setLocalVideoRef = useCallback(el => {
    localVideoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  // ── EXISTING: Socket starts once ──────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['polling', 'websocket'],
      forceNew: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => console.log('✅ Connected:', socket.id));
    socket.on('onlineCount', n => setOnlineCount(n));
    socket.on('waiting', () => setStatus('waiting'));

    socket.on('strangerFound', async ({ role, commonInterests }) => {
      setStatus('connected');
      statusRef.current = 'connected';
      setMessages([{ text: "✨ You're now chatting with someone new!", system: true }]);

      // ── FEATURE 1: Increment counter ──────────────────────────────────────
      setStrangerCount(prev => {
        const next = prev + 1;
        localStorage.setItem('ohmingle_count', String(next));
        return next;
      });

      // ── FEATURE 6: Start safe mode auto-remove timer ───────────────────────
      if (safeTimerRef.current) clearTimeout(safeTimerRef.current);
      setSafeTimer(false);
      safeTimerRef.current = setTimeout(() => setSafeTimer(true), 5000);

      // ── FEATURE 7: Show matched interests ─────────────────────────────────
      if (commonInterests && commonInterests.length > 0) {
        setMatchedInterests(commonInterests);
      } else {
        setMatchedInterests([]);
      }

      if (role === 'caller') {
        const pc = makePeer(socket);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', offer);
      }
    });

    socket.on('offer', async offer => {
      const pc = makePeer(socket);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', answer);
    });

    socket.on('answer', async answer => {
      if (peerRef.current)
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('iceCandidate', async c => {
      if (peerRef.current)
        try { await peerRef.current.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    });

    socket.on('message', data => {
      setMessages(prev => [...prev, { text: data.text, from: 'stranger' }]);
    });

    socket.on('strangerLeft', () => {
      setStatus('strangerLeft');
      statusRef.current = 'strangerLeft';
      closePeer();
      setMatchedInterests([]);
      setStrangerTyping(false);
      if (safeTimerRef.current) clearTimeout(safeTimerRef.current);
      setSafeTimer(false);
      setMessages(prev => [...prev, { text: '👋 Stranger disconnected.', system: true }]);
    });

    // ── FEATURE 5: Typing indicator from stranger ──────────────────────────
    socket.on('typing', () => {
      setStrangerTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setStrangerTyping(false), 2000);
    });

    return () => {
      socket.disconnect();
      closePeer();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (safeTimerRef.current) clearTimeout(safeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function makePeer(socket) {
    closePeer();
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    if (streamRef.current)
      streamRef.current.getTracks().forEach(t => pc.addTrack(t, streamRef.current));
    pc.ontrack = e => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };
    pc.onicecandidate = e => {
      if (e.candidate) socket.emit('iceCandidate', e.candidate);
    };
    peerRef.current = pc;
    return pc;
  }

  function closePeer() {
    if (peerRef.current) { peerRef.current.close(); peerRef.current = null; }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }

  const findStranger = () => {
    closePeer();
    setMessages([]);
    setMatchedInterests([]);
    setStrangerTyping(false);
    setStatus('searching');
    statusRef.current = 'searching';
    // ── FEATURE 7: Send interests with findStranger ────────────────────────
    socketRef.current?.emit('findStranger', { interests });
  };

  const skipStranger = () => {
    socketRef.current?.emit('skip');
    closePeer();
    setMessages([]);
    setMatchedInterests([]);
    setStrangerTyping(false);
    if (safeTimerRef.current) clearTimeout(safeTimerRef.current);
    setSafeTimer(false);
    setStatus('searching');
    statusRef.current = 'searching';
    setTimeout(() => socketRef.current?.emit('findStranger', { interests }), 500);
  };

  const sendMessage = () => {
    const text = inputMsg.trim();
    if (!text) return;
    if (statusRef.current !== 'connected') { alert('Find a stranger first!'); return; }
    socketRef.current?.emit('message', { text });
    setMessages(prev => [...prev, { text, from: 'me' }]);
    setInputMsg('');
    // Stop my typing indicator
    if (myTypingTimeout.current) clearTimeout(myTypingTimeout.current);
    myTypingRef.current = false;
  };

  // ── FEATURE 5: Emit typing when user types ─────────────────────────────
  const handleInputChange = (e) => {
    setInputMsg(e.target.value);
    if (statusRef.current !== 'connected') return;
    if (!myTypingRef.current) {
      myTypingRef.current = true;
      socketRef.current?.emit('typing');
    }
    if (myTypingTimeout.current) clearTimeout(myTypingTimeout.current);
    myTypingTimeout.current = setTimeout(() => {
      myTypingRef.current = false;
    }, 1000);
  };

  // ── FEATURE 4: Send emoji reaction ────────────────────────────────────
  const sendReaction = (emoji) => {
    if (statusRef.current !== 'connected') { alert('Connect to a stranger first!'); return; }
    socketRef.current?.emit('message', { text: emoji });
    setMessages(prev => [...prev, { text: emoji, from: 'me' }]);
  };

  const goHome = () => {
    closePeer();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    navigate('/');
  };

  const reportStranger = reason => {
    alert(`✅ Reported: "${reason}". Thank you!`);
    setShowReport(false);
    skipStranger();
  };

  const isIdle      = status === 'idle' || status === 'strangerLeft';
  const isSearching = status === 'searching' || status === 'waiting';

  // ── FEATURE 6: Blur logic ──────────────────────────────────────────────
  const showBlur = safeMode && status === 'connected' && !safeTimer;

  // ── SHARED RENDER PIECES ───────────────────────────────────────────────────

  const Header = () => (
    <div style={{...s.header, background:T.header, borderBottom:`1px solid ${T.headerBorder}`}}>
      {/* Logo + counter */}
      <div style={{display:'flex', alignItems:'center', gap:12}}>
        <span style={{...s.logo, color:T.logo}} onClick={goHome}>
          Ohm<span style={{color:'#a855f7'}}>ingle</span>
        </span>
        {/* FEATURE 1: Stranger counter */}
        <span style={{
          background: isDark ? '#1e293b' : '#f1f5f9',
          color: T.subText,
          fontSize:11, fontWeight:700,
          padding:'3px 8px', borderRadius:20,
          border:`1px solid ${T.headerBorder}`
        }}>
          👥 {strangerCount} met
        </span>
      </div>

      {/* Right side controls */}
      <div style={{display:'flex', alignItems:'center', gap:10}}>
        <span style={{...s.online, color:T.subText}}>
          <span style={s.dot}/>{onlineCount} online
        </span>

        {/* FEATURE 6: Safe mode toggle */}
        <button onClick={() => setSafeMode(p=>!p)} style={{
          background: safeMode ? '#7c3aed' : (isDark?'#1e293b':'#e2e8f0'),
          border:'none', borderRadius:20,
          padding:'4px 10px', fontSize:11, fontWeight:700,
          color: safeMode ? '#fff' : T.subText, cursor:'pointer'
        }}>
          {safeMode ? '🛡️ Safe' : '🛡️ Off'}
        </button>

        {/* FEATURE 2: Theme toggle */}
        <button onClick={toggleTheme} style={{
          background:'transparent', border:`1px solid ${T.headerBorder}`,
          borderRadius:20, padding:'4px 10px',
          fontSize:16, cursor:'pointer'
        }}>
          {isDark ? '☀️' : '🌙'}
        </button>
      </div>
    </div>
  );

  const VideoArea = ({ pipStyle, wrapStyle }) => (
    <div style={{...s.videoWrap, ...wrapStyle}}>
      {/* LARGE: remote/stranger video */}
      <video
        ref={remoteVideoRef}
        autoPlay playsInline
        style={{
          ...s.remoteVid,
          // FEATURE 6: blur filter
          filter: showBlur ? 'blur(12px)' : 'none',
          transition: 'filter 0.8s ease',
        }}
      />

      {/* FEATURE 6: safe mode overlay text */}
      {showBlur && (
        <div style={{
          position:'absolute', inset:0, display:'flex', flexDirection:'column',
          alignItems:'center', justifyContent:'center', zIndex:6, gap:8
        }}>
          <span style={{fontSize:32}}>🛡️</span>
          <p style={{color:'#fff', fontSize:14, fontWeight:700, margin:0, textAlign:'center'}}>
            Safe Mode Active
          </p>
          <p style={{color:'#94a3b8', fontSize:12, margin:0, textAlign:'center'}}>
            Video blurs for 5 seconds
          </p>
        </div>
      )}

      {/* Overlay when not connected */}
      {status !== 'connected' && (
        <div style={s.overlay}>
          {status === 'idle' && <p style={s.ovBig}>👋 {isMobile?'Tap':'Click'} Start!</p>}
          {isSearching && <>
            <div style={s.spinner}/>
            <p style={s.ovBig}>Finding stranger...</p>
            <p style={s.ovSub}>This takes a few seconds</p>
          </>}
          {status === 'strangerLeft' && <>
            <p style={s.ovBig}>👋 Stranger left!</p>
            <p style={s.ovSub}>Click Next to find someone</p>
          </>}
        </div>
      )}

      {/* SMALL: your video PiP */}
      <div style={pipStyle}>
        <video ref={setLocalVideoRef} autoPlay playsInline muted style={s.pipVid} />
        {/* FEATURE 3: your country flag */}
        <span style={s.youTxt}>{myFlag} You</span>
      </div>

      {/* Bottom bar */}
      <div style={s.vBottom}>
        <span style={s.brand}>Ohmingle.com</span>
        <button style={s.flagBtn} onClick={() => setShowReport(true)}>🚩</button>
      </div>

      {/* FEATURE 7: Matched interests bar */}
      {matchedInterests.length > 0 && (
        <div style={{
          position:'absolute', top:10, left:10, right: isMobile?100:170,
          display:'flex', gap:6, flexWrap:'wrap', zIndex:15
        }}>
          <span style={{color:'#fff', fontSize:11, fontWeight:700, background:'rgba(124,58,237,0.8)', padding:'3px 8px', borderRadius:10}}>
            ✨ Both like:
          </span>
          {matchedInterests.map(i => (
            <span key={i} style={{background:'rgba(34,197,94,0.8)', color:'#fff', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:10}}>
              {i}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const ChatArea = ({ style }) => (
    <div style={{...s.chatBox, background:T.chat, border:`1px solid ${T.chatBorder}`, ...style}}>
      {messages.length === 0 && (
        <p style={{...s.hint, color:T.hint}}>
          {status==='idle'      ? '👇 Click Start to find someone' :
           isSearching          ? '🔍 Searching...'                :
           status==='connected' ? '👋 Say hello!'                  :
                                  'Stranger left. Click Next!'}
        </p>
      )}
      {messages.map((msg, i) =>
        msg.system
          ? <p key={i} style={{...s.sysMsg, color:T.sysMsg}}>{msg.text}</p>
          : <div key={i} style={{
              ...s.bubble,
              alignSelf: msg.from==='me' ? 'flex-end' : 'flex-start',
              background: msg.from==='me' ? '#7c3aed' : T.bubble,
              color: msg.from==='me' ? '#fff' : T.text,
            }}>
              <span style={{...s.bName, color: msg.from==='me'?'rgba(255,255,255,0.5)':T.subText}}>
                {msg.from==='me'?'You':'Stranger'}
              </span>
              {msg.text}
            </div>
      )}
      {/* FEATURE 5: Typing indicator */}
      {strangerTyping && (
        <div style={{display:'flex', alignItems:'center', gap:6, padding:'4px 0'}}>
          <span style={{color:T.subText, fontSize:12, fontStyle:'italic'}}>Stranger is typing</span>
          <span style={{color:'#a855f7', fontSize:16, animation:'pulse 1s infinite'}}>●●●</span>
        </div>
      )}
      <div ref={messagesEndRef}/>
    </div>
  );

  const Controls = ({ desk }) => (
    <div style={{
      display:'flex', gap:desk?10:8,
      padding: desk?'12px 18px':'8px 10px 12px',
      flexShrink:0, alignItems:'center',
      background: T.bar, borderTop:`1px solid ${T.barBorder}`,
      flexDirection:'column',
    }}>
      {/* FEATURE 4: Reaction buttons row */}
      <div style={{display:'flex', gap:6, width:'100%'}}>
        {['👍','❤️','😂','😮','🔥'].map(emoji => (
          <button key={emoji} onClick={() => sendReaction(emoji)} style={{
            background: isDark?'#1e293b':'#f1f5f9',
            border: `1px solid ${T.inputBorder}`,
            borderRadius:20, padding:'4px 10px',
            fontSize:16, cursor:'pointer', flex:1,
          }}>
            {emoji}
          </button>
        ))}
      </div>

      {/* Main controls row */}
      <div style={{display:'flex', gap:desk?10:8, width:'100%', alignItems:'center'}}>
        {isIdle
          ? <button style={s.nextBtn} onClick={findStranger}>▶▶ Start</button>
          : <button style={s.nextBtn} onClick={skipStranger}>▶▶ Next</button>}
        <button style={s.stopBtn} onClick={goHome}>■</button>
        <input
          style={{...s.input, background:T.input, border:`1px solid ${T.inputBorder}`, color:T.text, fontSize:desk?15:14}}
          type="text" placeholder="Type message..."
          value={inputMsg}
          onChange={handleInputChange}
          onKeyDown={e => { if(e.key==='Enter'){e.preventDefault();sendMessage();} }}
        />
        <button style={s.sendBtn} onClick={sendMessage}>➤</button>
      </div>
    </div>
  );

  /* ── MOBILE ─────────────────────────────────────────────────────────────── */
  if (isMobile) return (
    <div style={{...s.page, background:T.page}}>
      <style>{CSS}</style>
      {showReport && <Modal onReport={reportStranger} onClose={() => setShowReport(false)} isDark={isDark} T={T}/>}
      <Header />
      <VideoArea pipStyle={s.mobPip} wrapStyle={{height:'47vh'}} />
      <ChatArea />
      <Controls desk={false} />
    </div>
  );

  /* ── DESKTOP ────────────────────────────────────────────────────────────── */
  return (
    <div style={{...s.page, background:T.page}}>
      <style>{CSS}</style>
      {showReport && <Modal onReport={reportStranger} onClose={() => setShowReport(false)} isDark={isDark} T={T}/>}
      <Header />
      <div style={s.deskBody}>
        <div style={s.deskLeft}>
          <VideoArea pipStyle={s.deskPip} wrapStyle={{width:'100%', height:'100%'}} />
        </div>
        <div style={{...s.deskRight, background:T.chat}}>
          <ChatArea style={{margin:0, borderRadius:0, border:'none', flex:1}} />
        </div>
      </div>
      <Controls desk={true} />
    </div>
  );
}

/* ── Helper: country code to flag emoji ──────────────────────────────────── */
function countryToFlag(code) {
  return code.toUpperCase().split('').map(c =>
    String.fromCodePoint(127397 + c.charCodeAt(0))
  ).join('');
}

/* ── Modal ───────────────────────────────────────────────────────────────── */
function Modal({ onReport, onClose, isDark, T }) {
  const reasons = ['🔞 Nudity/Sexual Content','😠 Harassment','🤖 Spam/Bot','👶 Underage','⚠️ Other'];
  return (
    <div style={s.modalBg}>
      <div style={{...s.modal, background: isDark?'#0f172a':'#fff', border:`1px solid ${T.headerBorder}`}}>
        <h3 style={{...s.modalH, color:T.logo}}>🚩 Report Stranger</h3>
        <p style={{...s.modalSub, color:T.subText}}>Why are you reporting?</p>
        {reasons.map(r => (
          <button key={r} style={{...s.modalOpt, background:T.bubble, color:T.text, border:`1px solid ${T.inputBorder}`}}
            onClick={() => onReport(r)}>{r}</button>
        ))}
        <button style={{...s.modalCancel, color:T.subText, border:`1px solid ${T.inputBorder}`}}
          onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ── CSS ─────────────────────────────────────────────────────────────────── */
const CSS = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  input::placeholder { color: #475569; }
  input:focus { border-color: #7c3aed !important; outline: none; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
`;

/* ── Styles ──────────────────────────────────────────────────────────────── */
const s = {
  modalBg:     { position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 },
  modal:       { borderRadius:20, padding:24, width:300, display:'flex', flexDirection:'column', gap:10 },
  modalH:      { fontSize:18, fontWeight:800, textAlign:'center', margin:0 },
  modalSub:    { fontSize:13, textAlign:'center', margin:0 },
  modalOpt:    { borderRadius:10, padding:'12px 16px', fontSize:14, cursor:'pointer', textAlign:'left' },
  modalCancel: { background:'transparent', borderRadius:10, padding:10, fontSize:13, cursor:'pointer' },

  page:     { position:'fixed', inset:0, display:'flex', flexDirection:'column', fontFamily:'system-ui,sans-serif', overflow:'hidden' },
  header:   { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 16px', flexShrink:0 },
  logo:     { fontSize:24, fontWeight:900, cursor:'pointer' },
  online:   { display:'flex', alignItems:'center', gap:6, fontSize:13, fontWeight:600 },
  dot:      { width:8, height:8, background:'#22c55e', borderRadius:'50%', boxShadow:'0 0 6px #22c55e', display:'inline-block' },

  videoWrap: { position:'relative', background:'#000', overflow:'hidden', flexShrink:0 },
  remoteVid: { width:'100%', height:'100%', objectFit:'cover', display:'block', background:'#111' },

  overlay:  { position:'absolute', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, zIndex:5 },
  spinner:  { width:50, height:50, border:'4px solid rgba(168,85,247,0.2)', borderTopColor:'#a855f7', borderRadius:'50%', animation:'spin 0.9s linear infinite' },
  ovBig:    { color:'#fff', fontSize:20, fontWeight:700, margin:0, textAlign:'center' },
  ovSub:    { color:'#94a3b8', fontSize:13, margin:0, textAlign:'center' },

  mobPip:   { position:'absolute', top:10, right:10, width:82, height:110, borderRadius:10, overflow:'hidden', border:'2.5px solid #7c3aed', boxShadow:'0 0 18px rgba(124,58,237,0.7)', zIndex:20, background:'#111' },
  deskPip:  { position:'absolute', top:14, right:14, width:152, height:203, borderRadius:12, overflow:'hidden', border:'2.5px solid #7c3aed', boxShadow:'0 0 24px rgba(124,58,237,0.7)', zIndex:20, background:'#111' },
  pipVid:   { width:'100%', height:'100%', objectFit:'cover', display:'block' },
  youTxt:   { position:'absolute', bottom:4, left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.75)', color:'#fff', fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:8, whiteSpace:'nowrap' },

  vBottom:  { position:'absolute', bottom:0, left:0, right:0, display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 14px', background:'linear-gradient(transparent,rgba(0,0,0,0.65))', zIndex:10 },
  brand:    { color:'#a855f7', fontWeight:800, fontSize:13 },
  flagBtn:  { background:'transparent', border:'none', fontSize:18, cursor:'pointer', padding:0 },

  chatBox:  { flex:1, margin:'8px 10px', borderRadius:14, padding:'12px', overflowY:'auto', display:'flex', flexDirection:'column', gap:8, minHeight:0 },
  hint:     { fontSize:14, textAlign:'center', marginTop:20, lineHeight:1.6 },
  sysMsg:   { fontSize:12, textAlign:'center', fontStyle:'italic', margin:'3px 0' },
  bubble:   { padding:'9px 13px', borderRadius:14, maxWidth:'80%', fontSize:14, lineHeight:1.5, wordBreak:'break-word' },
  bName:    { fontSize:10, fontWeight:700, display:'block', marginBottom:3 },

  nextBtn:  { background:'#22c55e', border:'none', borderRadius:12, padding:'0 18px', height:48, fontSize:14, fontWeight:700, color:'#fff', cursor:'pointer', flexShrink:0 },
  stopBtn:  { background:'#ef4444', border:'none', borderRadius:12, width:48, height:48, fontSize:16, color:'#fff', cursor:'pointer', flexShrink:0 },
  input:    { flex:1, borderRadius:12, padding:'0 16px', height:48, fontSize:14, outline:'none', minWidth:0 },
  sendBtn:  { background:'#7c3aed', border:'none', borderRadius:12, width:48, height:48, fontSize:18, color:'#fff', cursor:'pointer', flexShrink:0 },

  deskBody:  { flex:1, display:'flex', minHeight:0, overflow:'hidden' },
  deskLeft:  { flex:'0 0 66%', position:'relative', background:'#000', overflow:'hidden', borderRight:'1px solid #1e293b' },
  deskRight: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
};

export default ChatPage;