import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';

const BACKEND_URL = 'https://ohmingle-backend-production-ff22.up.railway.app';

function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [status, setStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);

  // All refs — never trigger re-renders
  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef        = useRef(null);
  const streamRef      = useRef(null);
  const socketRef      = useRef(null);
  const statusRef      = useRef('idle');
  const messagesEndRef = useRef(null);
  const inputRef       = useRef(''); // ✅ FIX: track input without re-render issues

  // Sync statusRef with status
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ✅ FIX: Camera starts ONCE, never restarted
  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        if (!mounted) return;
        streamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      })
      .catch(() => alert('Please allow camera and microphone!'));

    return () => { mounted = false; };
  }, []); // ← empty array: runs ONCE only

  // ✅ FIX: Socket starts ONCE, never restarted
  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['polling', 'websocket'],
      forceNew: true,
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => console.log('✅ Socket connected:', socket.id));
    socket.on('onlineCount', count => setOnlineCount(count));
    socket.on('waiting', () => setStatus('waiting'));

    socket.on('strangerFound', async ({ role }) => {
      setStatus('connected');
      statusRef.current = 'connected';
      setMessages([{ text: "✨ You're now chatting with someone new!", system: true }]);
      if (role === 'caller') {
        // We create offer
        const pc = buildPeerConnection(socket);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('offer', offer);
        } catch (e) { console.error(e); }
      }
    });

    socket.on('offer', async offer => {
      const pc = buildPeerConnection(socket);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', answer);
      } catch (e) { console.error(e); }
    });

    socket.on('answer', async answer => {
      if (peerRef.current) {
        try { await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer)); }
        catch (e) { console.error(e); }
      }
    });

    socket.on('iceCandidate', async candidate => {
      if (peerRef.current) {
        try { await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch (e) {}
      }
    });

    // ✅ FIX: ONLY updates messages — absolutely nothing else
    socket.on('message', data => {
      setMessages(prev => [...prev, { text: data.text, from: 'stranger' }]);
    });

    socket.on('strangerLeft', () => {
      setStatus('strangerLeft');
      statusRef.current = 'strangerLeft';
      closePeer();
      setMessages(prev => [...prev, { text: '👋 Stranger disconnected.', system: true }]);
    });

    return () => {
      socket.disconnect();
      closePeer();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []); // ← empty array: runs ONCE only — NO reconnects!

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Build WebRTC peer connection
  function buildPeerConnection(socket) {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    // ✅ FIX: Attach local stream tracks to peer
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track =>
        pc.addTrack(track, streamRef.current)
      );
    }
    // ✅ FIX: When remote stream arrives, attach to remote video
    pc.ontrack = event => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    pc.onicecandidate = event => {
      if (event.candidate) socket.emit('iceCandidate', event.candidate);
    };
    peerRef.current = pc;
    return pc;
  }

  function closePeer() {
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }

  const findStranger = useCallback(() => {
    closePeer();
    setMessages([]);
    setStatus('searching');
    statusRef.current = 'searching';
    socketRef.current?.emit('findStranger');
  }, []);

  const skipStranger = useCallback(() => {
    socketRef.current?.emit('skip');
    closePeer();
    setMessages([]);
    setStatus('searching');
    statusRef.current = 'searching';
    setTimeout(() => socketRef.current?.emit('findStranger'), 500);
  }, []);

  // ✅ FIX: sendMessage is 100% isolated — only sends message
  const sendMessage = useCallback(() => {
    const text = inputMsg.trim();
    if (!text) return;
    if (statusRef.current !== 'connected') {
      alert('Connect to a stranger first!');
      return;
    }
    socketRef.current?.emit('message', { text });
    setMessages(prev => [...prev, { text, from: 'me' }]);
    setInputMsg('');
  }, [inputMsg]);

  const goHome = useCallback(() => {
    closePeer();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    navigate('/');
  }, [navigate]);

  const reportStranger = (reason) => {
    alert(`✅ Reported for: "${reason}". Thank you!`);
    setShowReport(false);
    skipStranger();
  };

  const isIdle = status === 'idle' || status === 'strangerLeft';
  const isSearching = status === 'searching' || status === 'waiting';

  /* ── Report Modal ───────────────────────────── */
  const ReportModal = () => (
    <div style={s.modalOverlay}>
      <div style={s.modal}>
        <h3 style={s.modalTitle}>🚩 Report Stranger</h3>
        <p style={s.modalSub}>Why are you reporting?</p>
        {['🔞 Nudity/Sexual Content','😠 Harassment','🤖 Spam/Bot','👶 Underage','⚠️ Other'].map(r => (
          <button key={r} style={s.modalOption} onClick={() => reportStranger(r)}>{r}</button>
        ))}
        <button style={s.modalCancel} onClick={() => setShowReport(false)}>Cancel</button>
      </div>
    </div>
  );

  /* ── Status Overlay ─────────────────────────── */
  const Overlay = () => (
    <div style={s.overlay}>
      {status === 'idle' && <p style={s.overlayBig}>👋 {isMobile ? 'Tap' : 'Click'} Start!</p>}
      {isSearching && <>
        <div style={s.spinner} />
        <p style={s.overlayBig}>Finding stranger...</p>
        <p style={s.overlaySub}>This takes a few seconds</p>
      </>}
      {status === 'strangerLeft' && <>
        <p style={s.overlayBig}>👋 Stranger left!</p>
        <p style={s.overlaySub}>Click Next to find someone new</p>
      </>}
    </div>
  );

  /* ── Chat Messages ──────────────────────────── */
  const ChatMessages = () => (
    <>
      {messages.length === 0 && (
        <p style={s.hint}>
          {status === 'idle'      ? '👇 Click Start to find someone' :
           isSearching            ? '🔍 Searching for a stranger...' :
           status === 'connected' ? '👋 Say hello!'                  :
                                    'Stranger left. Click Next!'}
        </p>
      )}
      {messages.map((msg, i) =>
        msg.system
          ? <p key={i} style={s.sysMsg}>{msg.text}</p>
          : <div key={i} style={{
              ...s.bubble,
              alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start',
              background: msg.from === 'me' ? '#7c3aed' : '#1e293b',
            }}>
              <span style={s.bubbleName}>{msg.from === 'me' ? 'You' : 'Stranger'}</span>
              {msg.text}
            </div>
      )}
      <div ref={messagesEndRef} />
    </>
  );

  /* ── Bottom Controls ────────────────────────── */
  const Bar = ({ desk }) => (
    <div style={desk ? s.deskBar : s.mobBar}>
      {isIdle
        ? <button style={s.startBtn} onClick={findStranger}>▶▶ Start</button>
        : <button style={s.startBtn} onClick={skipStranger}>▶▶ Next</button>
      }
      <button style={s.stopBtn} onClick={goHome}>■</button>
      <input
        style={s.input}
        type="text"
        placeholder="Type message..."
        value={inputMsg}
        onChange={e => setInputMsg(e.target.value)}
        // ✅ FIX: onKeyDown prevents any bubbling, ONLY calls sendMessage
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            sendMessage();
          }
        }}
      />
      <button style={s.sendBtn} onClick={e => { e.stopPropagation(); sendMessage(); }}>➤</button>
    </div>
  );

  /* ── Video Section (shared) ─────────────────── */
  const VideoSection = ({ pipStyle }) => (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000', overflow: 'hidden' }}>
      {/* ✅ LARGE: Remote/stranger video fills entire area */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />

      {/* Status overlay when not connected */}
      {status !== 'connected' && <Overlay />}

      {/* ✅ SMALL: Local/your video in corner */}
      <div style={pipStyle}>
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <div style={s.youLabel}>You</div>
      </div>

      {/* Bottom bar with brand + report */}
      <div style={s.vBar}>
        <span style={s.brand}>Ohmingle.com</span>
        <button style={s.flagBtn} onClick={() => setShowReport(true)}>🚩</button>
      </div>
    </div>
  );

  /* ── MOBILE ─────────────────────────────────── */
  if (isMobile) return (
    <div style={s.mobPage}>
      <style>{CSS}</style>
      {showReport && <ReportModal />}
      <div style={s.header}>
        <span style={s.logo} onClick={goHome}>Ohm<span style={{color:'#a855f7'}}>ingle</span></span>
        <span style={s.online}><span style={s.dot}/>{onlineCount} online</span>
      </div>
      <div style={{ height: '47vh', flexShrink: 0 }}>
        <VideoSection pipStyle={s.mobPip} />
      </div>
      <div style={s.mobChat}><ChatMessages /></div>
      <Bar desk={false} />
    </div>
  );

  /* ── DESKTOP ────────────────────────────────── */
  return (
    <div style={s.deskPage}>
      <style>{CSS}</style>
      {showReport && <ReportModal />}
      <div style={s.header}>
        <span style={s.logo} onClick={goHome}>Ohm<span style={{color:'#a855f7'}}>ingle</span></span>
        <span style={s.online}><span style={s.dot}/>{onlineCount} online</span>
      </div>
      <div style={s.deskBody}>
        <div style={s.deskVideo}>
          <VideoSection pipStyle={s.deskPip} />
        </div>
        <div style={s.deskChat}>
          <div style={s.deskMsgs}><ChatMessages /></div>
        </div>
      </div>
      <Bar desk={true} />
    </div>
  );
}

const CSS = `
  @keyframes spin { to { transform: rotate(360deg); } }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #0a0a0f; }
  input::placeholder { color: #475569; }
  input:focus { border-color: #7c3aed !important; outline: none; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
`;

const s = {
  /* Modal */
  modalOverlay:{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 },
  modal:       { background:'#0f172a', border:'1px solid #1e293b', borderRadius:20, padding:24, width:300, display:'flex', flexDirection:'column', gap:10 },
  modalTitle:  { fontSize:18, fontWeight:800, color:'#fff', textAlign:'center', margin:0 },
  modalSub:    { color:'#64748b', fontSize:13, textAlign:'center', margin:0 },
  modalOption: { background:'#1e293b', border:'1px solid #334155', borderRadius:10, padding:'12px 16px', fontSize:14, cursor:'pointer', textAlign:'left', color:'#e2e8f0' },
  modalCancel: { background:'transparent', border:'1px solid #334155', borderRadius:10, padding:10, fontSize:13, cursor:'pointer', color:'#64748b' },

  /* Header */
  header: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 18px', background:'#0a0a0f', borderBottom:'1px solid #1e293b', flexShrink:0 },
  logo:   { fontSize:26, fontWeight:900, color:'#fff', cursor:'pointer' },
  online: { display:'flex', alignItems:'center', gap:6, color:'#94a3b8', fontSize:13, fontWeight:600 },
  dot:    { width:8, height:8, background:'#22c55e', borderRadius:'50%', boxShadow:'0 0 6px #22c55e' },

  /* Overlay */
  overlay:    { position:'absolute', inset:0, background:'rgba(0,0,0,0.8)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8 },
  spinner:    { width:50, height:50, border:'4px solid rgba(168,85,247,0.2)', borderTopColor:'#a855f7', borderRadius:'50%', animation:'spin 0.9s linear infinite' },
  overlayBig: { color:'#fff', fontSize:20, fontWeight:700, margin:0, textAlign:'center' },
  overlaySub: { color:'#94a3b8', fontSize:13, margin:0, textAlign:'center' },

  /* PiP — YOUR small video */
  mobPip:  { position:'absolute', top:10, right:10, width:80, height:107, borderRadius:10, overflow:'hidden', border:'2px solid #7c3aed', boxShadow:'0 0 16px rgba(124,58,237,0.6)', zIndex:20 },
  deskPip: { position:'absolute', top:14, right:14, width:150, height:200, borderRadius:12, overflow:'hidden', border:'2px solid #7c3aed', boxShadow:'0 0 24px rgba(124,58,237,0.6)', zIndex:20 },
  youLabel:{ position:'absolute', bottom:4, left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.7)', color:'#fff', fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:8, whiteSpace:'nowrap' },

  /* Video bottom bar */
  vBar:    { position:'absolute', bottom:0, left:0, right:0, display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 14px', background:'linear-gradient(transparent,rgba(0,0,0,0.6))', zIndex:10 },
  brand:   { color:'#a855f7', fontWeight:800, fontSize:13 },
  flagBtn: { background:'transparent', border:'none', fontSize:18, cursor:'pointer', padding:0 },

  /* Chat */
  hint:       { color:'#475569', fontSize:14, textAlign:'center', marginTop:20, lineHeight:1.6 },
  sysMsg:     { color:'#7c3aed', fontSize:12, textAlign:'center', fontStyle:'italic', margin:'3px 0' },
  bubble:     { padding:'9px 13px', borderRadius:14, maxWidth:'80%', fontSize:14, color:'#e2e8f0', lineHeight:1.5, wordBreak:'break-word' },
  bubbleName: { color:'rgba(255,255,255,0.5)', fontSize:10, fontWeight:700, display:'block', marginBottom:3 },

  /* Controls */
  startBtn: { background:'#22c55e', border:'none', borderRadius:12, padding:'0 20px', height:48, fontSize:14, fontWeight:700, color:'#fff', cursor:'pointer', flexShrink:0 },
  stopBtn:  { background:'#ef4444', border:'none', borderRadius:12, width:48, height:48, fontSize:16, color:'#fff', cursor:'pointer', flexShrink:0 },
  input:    { flex:1, background:'#0f172a', border:'1px solid #1e293b', borderRadius:12, padding:'0 16px', height:48, fontSize:14, color:'#e2e8f0', outline:'none', minWidth:0 },
  sendBtn:  { background:'#7c3aed', border:'none', borderRadius:12, width:48, height:48, fontSize:18, color:'#fff', cursor:'pointer', flexShrink:0 },

  /* Mobile layout */
  mobPage: { position:'fixed', inset:0, display:'flex', flexDirection:'column', background:'#0a0a0f', fontFamily:'system-ui,sans-serif', overflow:'hidden' },
  mobChat: { flex:1, margin:'8px 10px', background:'#0f172a', border:'1px solid #1e293b', borderRadius:14, padding:'12px', overflowY:'auto', display:'flex', flexDirection:'column', gap:8, minHeight:0 },
  mobBar:  { display:'flex', gap:8, padding:'8px 10px 12px', flexShrink:0, alignItems:'center' },

  /* Desktop layout */
  deskPage:  { position:'fixed', inset:0, display:'flex', flexDirection:'column', background:'#0a0a0f', fontFamily:'system-ui,sans-serif', overflow:'hidden' },
  deskBody:  { flex:1, display:'flex', minHeight:0, overflow:'hidden' },
  deskVideo: { flex:'0 0 66%', position:'relative', overflow:'hidden', borderRight:'1px solid #1e293b' },
  deskChat:  { flex:1, display:'flex', flexDirection:'column', background:'#0f172a', overflow:'hidden' },
  deskMsgs:  { flex:1, padding:'18px 16px', overflowY:'auto', display:'flex', flexDirection:'column', gap:8 },
  deskBar:   { display:'flex', gap:10, padding:'12px 18px', flexShrink:0, background:'#060608', borderTop:'1px solid #1e293b', alignItems:'center' },
};

export default ChatPage;