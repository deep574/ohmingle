import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';

// ✅ FIX 1: Added quotes + https://
const BACKEND_URL = 'https://ohmingle-backend-production-ff22.up.railway.app';

function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { interests = [] } = location.state || {};

  const [status, setStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  // ✅ FIX 2: Better mobile detection (touch + width)
  useEffect(() => {
    const check = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isNarrow = window.innerWidth < 1024;
      setIsMobile(hasTouch || isNarrow);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const cleanupPeer = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track =>
        pc.addTrack(track, localStreamRef.current)
      );
    }
    pc.ontrack = (event) => {
      if (remoteVideoRef.current)
        remoteVideoRef.current.srcObject = event.streams[0];
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current)
        socketRef.current.emit('iceCandidate', event.candidate);
    };
    peerConnectionRef.current = pc;
    return pc;
  }, []);

  const createOffer = useCallback(async () => {
    try {
      const pc = createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit('offer', offer);
    } catch (err) { console.error('Offer error:', err); }
  }, [createPeerConnection]);

  const handleOffer = useCallback(async (offer) => {
    try {
      const pc = createPeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current.emit('answer', answer);
    } catch (err) { console.error('Handle offer error:', err); }
  }, [createPeerConnection]);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) { alert('Please allow camera and microphone access!'); }
    };
    startCamera();

    // ✅ FIX 3: Enable websocket transport for real-time online count
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('✅ Connected to Railway:', socket.id);
    });

    // ✅ FIX 4: Always update online count when received
    socket.on('onlineCount', (count) => {
      console.log('👥 Online count:', count);
      setOnlineCount(count);
    });

    socket.on('waiting', () => setStatus('waiting'));
    socket.on('strangerFound', async ({ role }) => {
      setStatus('connected');
      setMessages([{ text: "✨ You're now chatting with someone new!", system: true }]);
      if (role === 'caller') await createOffer();
    });
    socket.on('offer', async (offer) => await handleOffer(offer));
    socket.on('answer', async (answer) => {
      if (peerConnectionRef.current)
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    });
    socket.on('iceCandidate', async (candidate) => {
      if (peerConnectionRef.current) {
        try { await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
      }
    });
    socket.on('message', (data) => {
      setMessages(prev => [...prev, { text: data.text, from: 'stranger' }]);
    });
    socket.on('strangerLeft', () => {
      setStatus('strangerLeft');
      cleanupPeer();
      setMessages(prev => [...prev, { text: '👋 Stranger has disconnected.', system: true }]);
    });

    return () => {
      socket.disconnect();
      cleanupPeer();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [createOffer, handleOffer, cleanupPeer]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const reportStranger = (reason) => {
    alert(`✅ Reported for: "${reason}". Thank you!`);
    setShowReport(false);
    skipStranger();
  };

  const findStranger = () => {
    cleanupPeer();
    setMessages([]);
    setStatus('searching');
    socketRef.current.emit('findStranger');
  };

  const skipStranger = () => {
    socketRef.current.emit('skip');
    cleanupPeer();
    setMessages([]);
    setStatus('searching');
    setTimeout(() => socketRef.current.emit('findStranger'), 500);
  };

  const sendMessage = () => {
    if (!inputMsg.trim()) return;
    if (status !== 'connected') { alert('Find a stranger first!'); return; }
    socketRef.current.emit('message', { text: inputMsg });
    setMessages(prev => [...prev, { text: inputMsg, from: 'me' }]);
    setInputMsg('');
  };

  const goHome = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    cleanupPeer();
    navigate('/');
  };

  const isSearching = status === 'searching' || status === 'waiting';
  const isIdle = status === 'idle' || status === 'strangerLeft';

  /* ─── Report Modal ─────────────────────────────── */
  const ReportModal = () => (
    <div style={s.modalOverlay}>
      <div style={s.modal}>
        <h3 style={s.modalTitle}>🚩 Report Stranger</h3>
        <p style={s.modalSub}>Why are you reporting?</p>
        {['🔞 Nudity/Sexual Content', '😠 Harassment', '🤖 Spam/Bot', '👶 Underage', '⚠️ Other'].map(r => (
          <button key={r} style={s.modalOption} onClick={() => reportStranger(r)}>{r}</button>
        ))}
        <button style={s.modalCancel} onClick={() => setShowReport(false)}>Cancel</button>
      </div>
    </div>
  );

  /* ─── Status Overlay (on video) ─────────────────── */
  const StatusOverlay = () => (
    <div style={s.overlay}>
      {status === 'idle' && (
        <p style={s.overlayTitle}>👋 {isMobile ? 'Tap' : 'Click'} Start!</p>
      )}
      {isSearching && (
        <div style={{ textAlign: 'center' }}>
          <div style={s.spinner} />
          <p style={s.overlayTitle}>Finding stranger...</p>
          <p style={s.overlaySubtitle}>This takes a few seconds</p>
        </div>
      )}
      {status === 'strangerLeft' && (
        <div style={{ textAlign: 'center' }}>
          <p style={s.overlayTitle}>👋 Stranger left!</p>
          <p style={s.overlaySubtitle}>Click Next to find someone new</p>
        </div>
      )}
    </div>
  );

  /* ─── Shared: Video Box ─────────────────────────── */
  const VideoBox = ({ videoStyle }) => (
    <div style={{ ...s.videoBox, ...videoStyle }}>
      <video ref={remoteVideoRef} autoPlay playsInline style={s.remoteVideo} />
      {status !== 'connected' && <StatusOverlay />}

      {/* PiP – your camera */}
      <div style={isMobile ? s.pipMob : s.pipDesk}>
        <video ref={localVideoRef} autoPlay playsInline muted style={s.pipVideo} />
        <span style={s.pipLabel}>You</span>
      </div>

      {/* Bottom bar inside video */}
      <div style={s.videoBottomBar}>
        <span style={s.watermark}>Ohmingle.com</span>
        <button style={s.flagBtn} onClick={() => setShowReport(true)}>🚩</button>
      </div>
    </div>
  );

  /* ─── Shared: Chat Messages ─────────────────────── */
  const ChatMessages = () => (
    <>
      {messages.length === 0 && (
        <p style={s.hintText}>
          {status === 'idle'        ? '🔍 Find a stranger to start chatting'       :
           isSearching              ? '🔍 Searching for someone to chat with...'    :
           status === 'connected'   ? '👋 Say hello!'                               :
                                      'Stranger left. Click Next to find someone.'}
        </p>
      )}
      {messages.map((msg, i) =>
        msg.system
          ? <p key={i} style={s.systemMsg}>{msg.text}</p>
          : (
            <div key={i} style={{
              ...s.bubble,
              alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start',
              background: msg.from === 'me' ? '#7c3aed' : '#1e293b',
            }}>
              <span style={{
                color: msg.from === 'me' ? '#c4b5fd' : '#94a3b8',
                fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 3
              }}>
                {msg.from === 'me' ? 'You' : 'Stranger'}
              </span>
              {msg.text}
            </div>
          )
      )}
      <div ref={messagesEndRef} />
    </>
  );

  /* ─── MOBILE LAYOUT ─────────────────────────────── */
  if (isMobile) {
    return (
      <div style={s.mobPage}>
        <style>{SPIN_CSS}</style>
        {showReport && <ReportModal />}

        {/* Header */}
        <div style={s.header}>
          <span style={s.logo} onClick={goHome}>
            Ohm<span style={{ color: '#a855f7' }}>ingle</span>
          </span>
          <span style={s.onlineCount}>
            <span style={s.onlineDot} />
            {onlineCount} online
          </span>
        </div>

        {/* Video — 46% of screen height */}
        <VideoBox videoStyle={s.mobVideoSize} />

        {/* Chat area */}
        <div style={s.mobChatBox}>
          <ChatMessages />
        </div>

        {/* Bottom controls */}
        <div style={s.mobBar}>
          {isIdle
            ? <button style={s.nextBtn} onClick={findStranger}>▶▶ Start</button>
            : <button style={s.nextBtn} onClick={skipStranger}>▶▶ Next</button>
          }
          <button style={s.stopBtn} onClick={goHome}>■</button>
          <input
            style={s.msgInput}
            type="text"
            placeholder="Type message..."
            value={inputMsg}
            onChange={e => setInputMsg(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && sendMessage()}
          />
          <button style={s.sendBtn} onClick={sendMessage}>➤</button>
        </div>
      </div>
    );
  }

  /* ─── DESKTOP LAYOUT ────────────────────────────── */
  return (
    <div style={s.deskPage}>
      <style>{SPIN_CSS}</style>
      {showReport && <ReportModal />}

      {/* Header – full width */}
      <div style={s.header}>
        <span style={s.logo} onClick={goHome}>
          Ohm<span style={{ color: '#a855f7' }}>ingle</span>
        </span>
        <span style={s.onlineCount}>
          <span style={s.onlineDot} />
          {onlineCount} online
        </span>
      </div>

      {/* Body – video (left 68%) + chat (right 32%) */}
      <div style={s.deskBody}>
        <VideoBox videoStyle={s.deskVideoSize} />

        {/* Chat panel */}
        <div style={s.deskChatPanel}>
          <div style={s.deskMsgArea}>
            <ChatMessages />
          </div>
        </div>
      </div>

      {/* Bottom bar – full width */}
      <div style={s.deskBar}>
        {isIdle
          ? <button style={s.nextBtn} onClick={findStranger}>
              ▶▶ Start <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>Enter</span>
            </button>
          : <button style={s.nextBtn} onClick={skipStranger}>
              ▶▶ Next <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>Esc</span>
            </button>
        }
        <button style={s.stopBtn} onClick={goHome}>■</button>
        <input
          style={{ ...s.msgInput, fontSize: 15 }}
          type="text"
          placeholder="Type message..."
          value={inputMsg}
          onChange={e => setInputMsg(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && sendMessage()}
        />
        <button style={s.sendBtn} onClick={sendMessage}>➤</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SPIN ANIMATION
══════════════════════════════════════════════════════ */
const SPIN_CSS = `
  @keyframes spin { to { transform: rotate(360deg); } }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #0a0a0f; }
  input::placeholder { color: #475569; }
  input:focus { border-color: #7c3aed !important; outline: none; }
  video { background: #111; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
`;

/* ══════════════════════════════════════════════════════
   ALL STYLES
══════════════════════════════════════════════════════ */
const s = {
  /* ── Report Modal ── */
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal:        { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 20, padding: 24, width: 300, display: 'flex', flexDirection: 'column', gap: 10 },
  modalTitle:   { fontSize: 18, fontWeight: 800, color: '#fff', textAlign: 'center', margin: 0 },
  modalSub:     { color: '#64748b', fontSize: 13, textAlign: 'center', margin: 0 },
  modalOption:  { background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '12px 16px', fontSize: 14, cursor: 'pointer', textAlign: 'left', color: '#e2e8f0', fontWeight: 500 },
  modalCancel:  { background: 'transparent', border: '1px solid #334155', borderRadius: 10, padding: 10, fontSize: 13, cursor: 'pointer', color: '#64748b' },

  /* ── Shared Header ── */
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', flexShrink: 0, background: '#0a0a0f', borderBottom: '1px solid #1e293b' },
  logo:        { fontSize: 28, fontWeight: 900, color: '#fff', cursor: 'pointer', letterSpacing: -0.5 },
  onlineCount: { display: 'flex', alignItems: 'center', gap: 7, color: '#94a3b8', fontSize: 14, fontWeight: 600 },
  onlineDot:   { width: 9, height: 9, background: '#22c55e', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 6px #22c55e' },

  /* ── Video Box ── */
  videoBox:    { position: 'relative', background: '#000', overflow: 'hidden', flexShrink: 0 },
  remoteVideo: { width: '100%', height: '100%', objectFit: 'cover', display: 'block', transform: 'scaleX(-1)' },

  /* ── Overlay ── */
  overlay:         { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  spinner:         { width: 52, height: 52, border: '4px solid rgba(168,85,247,0.15)', borderTopColor: '#a855f7', borderRadius: '50%', animation: 'spin 0.9s linear infinite', marginBottom: 14 },
  overlayTitle:    { color: '#fff', fontSize: 22, fontWeight: 700, textAlign: 'center', margin: 0, marginBottom: 6 },
  overlaySubtitle: { color: '#94a3b8', fontSize: 14, textAlign: 'center', margin: 0 },

  /* ── PiP camera ── */
  pipMob:   { position: 'absolute', top: 12, right: 12, width: 90,  height: 120, borderRadius: 12, overflow: 'hidden', border: '2.5px solid #7c3aed', boxShadow: '0 4px 16px rgba(124,58,237,0.5)' },
  pipDesk:  { position: 'absolute', top: 16, right: 16, width: 150, height: 200, borderRadius: 14, overflow: 'hidden', border: '2.5px solid #7c3aed', boxShadow: '0 6px 24px rgba(124,58,237,0.5)' },
  pipVideo: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' },
  pipLabel: { position: 'absolute', bottom: 5, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' },

  /* ── Video bottom bar ── */
  videoBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'linear-gradient(transparent, rgba(0,0,0,0.65))' },
  watermark:      { color: '#a855f7', fontWeight: 800, fontSize: 14, opacity: 0.9 },
  flagBtn:        { background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 },

  /* ── Chat ── */
  hintText:  { color: '#475569', fontSize: 14, fontWeight: 500, textAlign: 'center', marginTop: 24, lineHeight: 1.6 },
  systemMsg: { color: '#7c3aed', fontSize: 13, textAlign: 'center', fontStyle: 'italic', margin: '4px 0' },
  bubble:    { padding: '10px 14px', borderRadius: 16, maxWidth: '80%', fontSize: 14, color: '#e2e8f0', lineHeight: 1.5, wordBreak: 'break-word' },

  /* ── Shared Buttons ── */
  nextBtn: { background: '#22c55e', border: 'none', borderRadius: 14, padding: '0 22px', height: 50, fontSize: 15, fontWeight: 700, color: '#fff', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 },
  stopBtn: { background: '#ef4444', border: 'none', borderRadius: 14, width: 50, height: 50, fontSize: 18, color: '#fff', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  msgInput:{ flex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14, padding: '0 18px', height: 50, fontSize: 14, color: '#e2e8f0', outline: 'none', minWidth: 0 },
  sendBtn: { background: '#7c3aed', border: 'none', borderRadius: 14, width: 50, height: 50, fontSize: 19, color: '#fff', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },

  /* ── MOBILE specific ── */
  mobPage:    { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0a0a0f', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  mobVideoSize:{ height: '46vh', width: '100%' },
  mobChatBox: { flex: 1, margin: '10px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: '14px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 },
  mobBar:     { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 14px', flexShrink: 0, background: '#0a0a0f' },

  /* ── DESKTOP specific ── */
  deskPage:     { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0a0a0f', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  deskBody:     { flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', gap: 0 },
  deskVideoSize:{ flex: '0 0 68%', height: '100%', borderRight: '1px solid #1e293b' },
  deskChatPanel:{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' },
  deskMsgArea:  { flex: 1, padding: '20px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 },
  deskBar:      { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', flexShrink: 0, background: '#060608', borderTop: '1px solid #1e293b' },
};

export default ChatPage;