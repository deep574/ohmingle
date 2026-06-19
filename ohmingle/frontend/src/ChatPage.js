import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

const BACKEND_URL = 'https://ohmingle-backend-production-ff22.up.railway.app';

function ChatPage() {
  const navigate = useNavigate();

  const [status, setStatus]           = useState('idle');
  const [messages, setMessages]       = useState([]);
  const [inputMsg, setInputMsg]       = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [showReport, setShowReport]   = useState(false);
  const [isMobile, setIsMobile]       = useState(window.innerWidth < 1024);

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

  // ── Camera: starts once, attaches to ref ──────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        streamRef.current = stream;
        // Attach to local video element directly
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
      })
      .catch(() => alert('Please allow camera & microphone!'));
  }, []);

  // Re-attach local stream whenever localVideoRef mounts/remounts
  const setLocalVideoRef = useCallback(el => {
    localVideoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  // ── Socket: starts once ───────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['polling', 'websocket'],
      forceNew: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => console.log('✅ Connected:', socket.id));
    socket.on('onlineCount', n => setOnlineCount(n));
    socket.on('waiting', () => setStatus('waiting'));

    socket.on('strangerFound', async ({ role }) => {
      setStatus('connected');
      statusRef.current = 'connected';
      setMessages([{ text: "✨ You're now chatting with someone new!", system: true }]);
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

    // ✅ ONLY updates messages — nothing else
    socket.on('message', data => {
      setMessages(prev => [...prev, { text: data.text, from: 'stranger' }]);
    });

    socket.on('strangerLeft', () => {
      setStatus('strangerLeft');
      statusRef.current = 'strangerLeft';
      closePeer();
      setMessages(prev => [...prev, { text: '👋 Stranger disconnected.', system: true }]);
    });

    return () => { socket.disconnect(); closePeer(); };
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
    setStatus('searching');
    statusRef.current = 'searching';
    socketRef.current?.emit('findStranger');
  };

  const skipStranger = () => {
    socketRef.current?.emit('skip');
    closePeer();
    setMessages([]);
    setStatus('searching');
    statusRef.current = 'searching';
    setTimeout(() => socketRef.current?.emit('findStranger'), 500);
  };

  // ✅ sendMessage: ONLY sends message, nothing else
  const sendMessage = () => {
    const text = inputMsg.trim();
    if (!text) return;
    if (statusRef.current !== 'connected') { alert('Find a stranger first!'); return; }
    socketRef.current?.emit('message', { text });
    setMessages(prev => [...prev, { text, from: 'me' }]);
    setInputMsg('');
  };

  const goHome = () => {
    closePeer();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    navigate('/');
  };

  const isIdle      = status === 'idle' || status === 'strangerLeft';
  const isSearching = status === 'searching' || status === 'waiting';

  /* ── Report Modal ──────────────────────────────────────────────────── */
  const reportStranger = reason => {
    alert(`✅ Reported: "${reason}". Thank you!`);
    setShowReport(false);
    skipStranger();
  };

  /* ── MOBILE ────────────────────────────────────────────────────────── */
  if (isMobile) return (
    <div style={s.page}>
      <style>{CSS}</style>
      {showReport && <Modal onReport={reportStranger} onClose={() => setShowReport(false)} />}

      {/* Header */}
      <div style={s.header}>
        <span style={s.logo} onClick={goHome}>Ohm<span style={{color:'#a855f7'}}>ingle</span></span>
        <span style={s.online}><span style={s.dot}/>{onlineCount} online</span>
      </div>

      {/* Video area — remote fills box, local = small PiP */}
      <div style={{...s.videoWrap, height:'47vh'}}>
        {/* LARGE: stranger video */}
        <video ref={remoteVideoRef} autoPlay playsInline
          style={s.remoteVid} />

        {/* Overlay when not connected */}
        {status !== 'connected' && <Overlay status={status} isSearching={isSearching} mob />}

        {/* SMALL: your video — callback ref ensures stream always attached */}
        <div style={s.mobPip}>
          <video ref={setLocalVideoRef} autoPlay playsInline muted style={s.pipVid} />
          <span style={s.youTxt}>You</span>
        </div>

        <div style={s.vBottom}>
          <span style={s.brand}>Ohmingle.com</span>
          <button style={s.flagBtn} onClick={() => setShowReport(true)}>🚩</button>
        </div>
      </div>

      {/* Chat */}
      <div style={s.chatBox}>
        <Messages messages={messages} status={status} isSearching={isSearching} messagesEndRef={messagesEndRef} />
      </div>

      {/* Controls */}
      <div style={s.bar}>
        {isIdle
          ? <button style={s.nextBtn} onClick={findStranger}>▶▶ Start</button>
          : <button style={s.nextBtn} onClick={skipStranger}>▶▶ Next</button>}
        <button style={s.stopBtn} onClick={goHome}>■</button>
        <input style={s.input} type="text" placeholder="Type message..."
          value={inputMsg} onChange={e => setInputMsg(e.target.value)}
          onKeyDown={e => { if (e.key==='Enter'){e.preventDefault();sendMessage();} }} />
        <button style={s.sendBtn} onClick={sendMessage}>➤</button>
      </div>
    </div>
  );

  /* ── DESKTOP ───────────────────────────────────────────────────────── */
  return (
    <div style={s.page}>
      <style>{CSS}</style>
      {showReport && <Modal onReport={reportStranger} onClose={() => setShowReport(false)} />}

      <div style={s.header}>
        <span style={s.logo} onClick={goHome}>Ohm<span style={{color:'#a855f7'}}>ingle</span></span>
        <span style={s.online}><span style={s.dot}/>{onlineCount} online</span>
      </div>

      <div style={s.deskBody}>
        {/* Left: video */}
        <div style={s.deskLeft}>
          {/* LARGE: stranger */}
          <video ref={remoteVideoRef} autoPlay playsInline style={s.remoteVid} />

          {status !== 'connected' && <Overlay status={status} isSearching={isSearching} />}

          {/* SMALL: you */}
          <div style={s.deskPip}>
            <video ref={setLocalVideoRef} autoPlay playsInline muted style={s.pipVid} />
            <span style={s.youTxt}>You</span>
          </div>

          <div style={s.vBottom}>
            <span style={s.brand}>Ohmingle.com</span>
            <button style={s.flagBtn} onClick={() => setShowReport(true)}>🚩</button>
          </div>
        </div>

        {/* Right: chat */}
        <div style={s.deskRight}>
          <div style={s.deskMsgs}>
            <Messages messages={messages} status={status} isSearching={isSearching} messagesEndRef={messagesEndRef} />
          </div>
        </div>
      </div>

      <div style={s.deskBar}>
        {isIdle
          ? <button style={s.nextBtn} onClick={findStranger}>▶▶ Start</button>
          : <button style={s.nextBtn} onClick={skipStranger}>▶▶ Next</button>}
        <button style={s.stopBtn} onClick={goHome}>■</button>
        <input style={{...s.input, fontSize:15}} type="text" placeholder="Type message..."
          value={inputMsg} onChange={e => setInputMsg(e.target.value)}
          onKeyDown={e => { if (e.key==='Enter'){e.preventDefault();sendMessage();} }} />
        <button style={s.sendBtn} onClick={sendMessage}>➤</button>
      </div>
    </div>
  );
}

/* ── Pure components (no refs, no side-effects) ─────────────────────── */
function Modal({ onReport, onClose }) {
  const reasons = ['🔞 Nudity/Sexual Content','😠 Harassment','🤖 Spam/Bot','👶 Underage','⚠️ Other'];
  return (
    <div style={s.modalBg}>
      <div style={s.modal}>
        <h3 style={s.modalH}>🚩 Report Stranger</h3>
        <p style={s.modalSub}>Why are you reporting?</p>
        {reasons.map(r => <button key={r} style={s.modalOpt} onClick={() => onReport(r)}>{r}</button>)}
        <button style={s.modalCancel} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function Overlay({ status, isSearching, mob }) {
  return (
    <div style={s.overlay}>
      {status === 'idle' && <p style={s.ovBig}>👋 {mob ? 'Tap' : 'Click'} Start!</p>}
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
  );
}

function Messages({ messages, status, isSearching, messagesEndRef }) {
  const isIdle = status === 'idle' || status === 'strangerLeft';
  return (
    <>
      {messages.length === 0 && (
        <p style={s.hint}>
          {status==='idle'      ? '👇 Click Start to find someone' :
           isSearching          ? '🔍 Searching...'                :
           status==='connected' ? '👋 Say hello!'                  :
                                  'Stranger left. Click Next!'}
        </p>
      )}
      {messages.map((msg, i) =>
        msg.system
          ? <p key={i} style={s.sysMsg}>{msg.text}</p>
          : <div key={i} style={{
              ...s.bubble,
              alignSelf: msg.from==='me' ? 'flex-end' : 'flex-start',
              background: msg.from==='me' ? '#7c3aed' : '#1e293b',
            }}>
              <span style={s.bName}>{msg.from==='me'?'You':'Stranger'}</span>
              {msg.text}
            </div>
      )}
      <div ref={messagesEndRef}/>
    </>
  );
}

/* ── CSS ─────────────────────────────────────────────────────────────── */
const CSS = `
  @keyframes spin { to { transform: rotate(360deg); } }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #0a0a0f; }
  input::placeholder { color: #475569; }
  input:focus { border-color: #7c3aed !important; outline: none; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
`;

/* ── Styles ──────────────────────────────────────────────────────────── */
const s = {
  /* Modal */
  modalBg:     { position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 },
  modal:       { background:'#0f172a', border:'1px solid #1e293b', borderRadius:20, padding:24, width:300, display:'flex', flexDirection:'column', gap:10 },
  modalH:      { fontSize:18, fontWeight:800, color:'#fff', textAlign:'center', margin:0 },
  modalSub:    { color:'#64748b', fontSize:13, textAlign:'center', margin:0 },
  modalOpt:    { background:'#1e293b', border:'1px solid #334155', borderRadius:10, padding:'12px 16px', fontSize:14, cursor:'pointer', textAlign:'left', color:'#e2e8f0' },
  modalCancel: { background:'transparent', border:'1px solid #334155', borderRadius:10, padding:10, fontSize:13, cursor:'pointer', color:'#64748b' },

  /* Layout */
  page:     { position:'fixed', inset:0, display:'flex', flexDirection:'column', background:'#0a0a0f', fontFamily:'system-ui,sans-serif', overflow:'hidden' },
  header:   { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 18px', background:'#0a0a0f', borderBottom:'1px solid #1e293b', flexShrink:0 },
  logo:     { fontSize:26, fontWeight:900, color:'#fff', cursor:'pointer' },
  online:   { display:'flex', alignItems:'center', gap:6, color:'#94a3b8', fontSize:13, fontWeight:600 },
  dot:      { width:8, height:8, background:'#22c55e', borderRadius:'50%', boxShadow:'0 0 6px #22c55e', display:'inline-block' },

  /* Video */
  videoWrap: { position:'relative', background:'#000', overflow:'hidden', flexShrink:0 },
  remoteVid: { width:'100%', height:'100%', objectFit:'cover', display:'block', background:'#111' },

  /* Overlay */
  overlay:  { position:'absolute', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, zIndex:5 },
  spinner:  { width:50, height:50, border:'4px solid rgba(168,85,247,0.2)', borderTopColor:'#a855f7', borderRadius:'50%', animation:'spin 0.9s linear infinite' },
  ovBig:    { color:'#fff', fontSize:20, fontWeight:700, margin:0, textAlign:'center' },
  ovSub:    { color:'#94a3b8', fontSize:13, margin:0, textAlign:'center' },

  /* PiP — YOUR video */
  mobPip:   { position:'absolute', top:10, right:10, width:82, height:110, borderRadius:10, overflow:'hidden', border:'2.5px solid #7c3aed', boxShadow:'0 0 18px rgba(124,58,237,0.7)', zIndex:20, background:'#111' },
  deskPip:  { position:'absolute', top:14, right:14, width:152, height:203, borderRadius:12, overflow:'hidden', border:'2.5px solid #7c3aed', boxShadow:'0 0 24px rgba(124,58,237,0.7)', zIndex:20, background:'#111' },
  pipVid:   { width:'100%', height:'100%', objectFit:'cover', display:'block' },
  youTxt:   { position:'absolute', bottom:4, left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.75)', color:'#fff', fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:8, whiteSpace:'nowrap' },

  /* Video bottom bar */
  vBottom:  { position:'absolute', bottom:0, left:0, right:0, display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 14px', background:'linear-gradient(transparent,rgba(0,0,0,0.65))', zIndex:10 },
  brand:    { color:'#a855f7', fontWeight:800, fontSize:13 },
  flagBtn:  { background:'transparent', border:'none', fontSize:18, cursor:'pointer', padding:0 },

  /* Chat */
  chatBox:  { flex:1, margin:'8px 10px', background:'#0f172a', border:'1px solid #1e293b', borderRadius:14, padding:'12px', overflowY:'auto', display:'flex', flexDirection:'column', gap:8, minHeight:0 },
  hint:     { color:'#475569', fontSize:14, textAlign:'center', marginTop:20, lineHeight:1.6 },
  sysMsg:   { color:'#7c3aed', fontSize:12, textAlign:'center', fontStyle:'italic', margin:'3px 0' },
  bubble:   { padding:'9px 13px', borderRadius:14, maxWidth:'80%', fontSize:14, color:'#e2e8f0', lineHeight:1.5, wordBreak:'break-word' },
  bName:    { color:'rgba(255,255,255,0.45)', fontSize:10, fontWeight:700, display:'block', marginBottom:3 },

  /* Controls */
  bar:      { display:'flex', gap:8, padding:'8px 10px 12px', flexShrink:0, alignItems:'center' },
  nextBtn:  { background:'#22c55e', border:'none', borderRadius:12, padding:'0 18px', height:48, fontSize:14, fontWeight:700, color:'#fff', cursor:'pointer', flexShrink:0 },
  stopBtn:  { background:'#ef4444', border:'none', borderRadius:12, width:48, height:48, fontSize:16, color:'#fff', cursor:'pointer', flexShrink:0 },
  input:    { flex:1, background:'#0f172a', border:'1px solid #1e293b', borderRadius:12, padding:'0 16px', height:48, fontSize:14, color:'#e2e8f0', outline:'none', minWidth:0 },
  sendBtn:  { background:'#7c3aed', border:'none', borderRadius:12, width:48, height:48, fontSize:18, color:'#fff', cursor:'pointer', flexShrink:0 },

  /* Desktop specific */
  deskBody:  { flex:1, display:'flex', minHeight:0, overflow:'hidden' },
  deskLeft:  { flex:'0 0 66%', position:'relative', background:'#000', overflow:'hidden', borderRight:'1px solid #1e293b' },
  deskRight: { flex:1, display:'flex', flexDirection:'column', background:'#0f172a', overflow:'hidden' },
  deskMsgs:  { flex:1, padding:'18px 16px', overflowY:'auto', display:'flex', flexDirection:'column', gap:8 },
  deskBar:   { display:'flex', gap:10, padding:'12px 18px', flexShrink:0, background:'#060608', borderTop:'1px solid #1e293b', alignItems:'center' },
};

export default ChatPage;