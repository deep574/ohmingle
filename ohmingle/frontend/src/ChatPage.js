import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';

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
  // Refs to call latest functions from inside socket handlers without
  // re-running the socket-setup effect (this is the fix for the
  // "sending a message disconnects me" bug).
  const createOfferRef = useRef(null);
  const handleOfferRef = useRef(null);

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

  // Keep refs in sync with the latest function instances every render,
  // WITHOUT this being a dependency of the socket-setup effect below.
  useEffect(() => {
    createOfferRef.current = createOffer;
    handleOfferRef.current = handleOffer;
  });

  // ── SOCKET + CAMERA SETUP — RUNS EXACTLY ONCE ────────────────────────────
  // CRITICAL FIX: empty dependency array [] means this effect (and its
  // cleanup, which calls socket.disconnect()) NEVER re-runs after mount.
  // Previously this had [createOffer, handleOffer, cleanupPeer] as deps —
  // those functions got new identities on certain re-renders (e.g. when
  // sendMessage() called setMessages()), which caused React to tear down
  // and recreate the socket connection, looking exactly like the sender
  // being disconnected. That bug is now fixed.
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) { alert('Please allow camera and microphone access!'); }
    };
    startCamera();

    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to backend:', socket.id);
    });

    socket.on('onlineCount', (count) => {
      setOnlineCount(count);
    });

    socket.on('waiting', () => setStatus('waiting'));
    socket.on('strangerFound', async ({ role }) => {
      setStatus('connected');
      setMessages([{ text: "You're now chatting with someone new!", system: true }]);
      if (role === 'caller') await createOfferRef.current();
    });
    socket.on('offer', async (offer) => await handleOfferRef.current(offer));
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
      setMessages(prev => [...prev, { text: 'Stranger has disconnected.', system: true }]);
    });

    return () => {
      socket.disconnect();
      cleanupPeer();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // <-- empty array = run once on mount, never on message/state changes

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const reportStranger = (reason) => {
    alert(`Reported for: "${reason}". Thank you!`);
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

  // FIX confirmed: sendMessage ONLY emits 'message'. It does not touch
  // status, does not call cleanupPeer, does not call skip/findStranger,
  // and does not disconnect the socket. This was already correct in your
  // code — the real bug was the effect re-running (fixed above).
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

  const ReportModal = () => (
    <div style={s.modalOverlay}>
      <div style={s.modal}>
        <h3 style={s.modalTitle}>Report Stranger</h3>
        <p style={s.modalSub}>Why are you reporting?</p>
        {['Nudity/Sexual Content', 'Harassment', 'Spam/Bot', 'Underage', 'Other'].map(r => (
          <button key={r} style={s.modalOption} onClick={() => reportStranger(r)}>{r}</button>
        ))}
        <button style={s.modalCancel} onClick={() => setShowReport(false)}>Cancel</button>
      </div>
    </div>
  );

  const StatusOverlay = () => (
    <div style={s.overlay}>
      {status === 'idle' && (
        <p style={s.overlayTitle}>{isMobile ? 'Tap' : 'Click'} Start!</p>
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
          <p style={s.overlayTitle}>Stranger left!</p>
          <p style={s.overlaySubtitle}>Click Next to find someone new</p>
        </div>
      )}
    </div>
  );

  const VideoBox = ({ videoStyle }) => (
    <div style={{ ...s.videoBox, ...videoStyle }}>
      <video ref={remoteVideoRef} autoPlay playsInline style={s.remoteVideo} />
      {status !== 'connected' && <StatusOverlay />}

      <div style={isMobile ? s.pipMob : s.pipDesk}>
        <video ref={localVideoRef} autoPlay playsInline muted style={s.pipVideo} />
        <span style={s.pipLabel}>You</span>
      </div>

      <div style={s.videoBottomBar}>
        <span style={s.watermark}>Ohmingle</span>
        <button style={s.flagBtn} onClick={() => setShowReport(true)}>Report</button>
      </div>
    </div>
  );

  const ChatMessages = () => (
    <>
      {messages.length === 0 && (
        <p style={s.hintText}>
          {status === 'idle'        ? 'Find a stranger to start chatting'       :
           isSearching              ? 'Searching for someone to chat with...'    :
           status === 'connected'   ? 'Say hello!'                               :
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

        <div style={s.header}>
          <span style={s.logo} onClick={goHome}>
            Ohm<span style={{ color: '#a855f7' }}>ingle</span>
          </span>
          <span style={s.onlineCount}>
            <span style={s.onlineDot} />
            {onlineCount} online
          </span>
        </div>

        <VideoBox videoStyle={s.mobVideoSize} />

        <div style={s.mobChatBox}>
          <ChatMessages />
        </div>

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

      <div style={s.header}>
        <span style={s.logo} onClick={goHome}>
          Ohm<span style={{ color: '#a855f7' }}>ingle</span>
        </span>
        <span style={s.onlineCount}>
          <span style={s.onlineDot} />
          {onlineCount} online
        </span>
      </div>

      <div style={s.deskBody}>
        <VideoBox videoStyle={s.deskVideoSize} />

        <div style={s.deskChatPanel}>
          <div style={s.deskMsgArea}>
            <ChatMessages />
          </div>
        </div>
      </div>

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

const s = {
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal:        { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 20, padding: 24, width: 300, display: 'flex', flexDirection: 'column', gap: 10 },
  modalTitle:   { fontSize: 18, fontWeight: 800, color: '#fff', textAlign: 'center', margin: 0 },
  modalSub:     { color: '#64748b', fontSize: 13, textAlign: 'center', margin: 0 },
  modalOption:  { background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: '12px 16px', fontSize: 14, cursor: 'pointer', textAlign: 'left', color: '#e2e8f0', fontWeight: 500 },
  modalCancel:  { background: 'transparent', border: '1px solid #334155', borderRadius: 10, padding: 10, fontSize: 13, cursor: 'pointer', color: '#64748b' },

  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', flexShrink: 0, background: '#0a0a0f', borderBottom: '1px solid #1e293b' },
  logo:        { fontSize: 30, fontWeight: 900, color: '#fff', cursor: 'pointer', letterSpacing: -0.5 },
  onlineCount: { display: 'flex', alignItems: 'center', gap: 7, color: '#94a3b8', fontSize: 15, fontWeight: 600 },
  onlineDot:   { width: 9, height: 9, background: '#22c55e', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 6px #22c55e' },

  videoBox:    { position: 'relative', background: '#000', overflow: 'hidden', flexShrink: 0 },
  remoteVideo: { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' },

  overlay:         { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  spinner:         { width: 56, height: 56, border: '4px solid rgba(168,85,247,0.15)', borderTopColor: '#a855f7', borderRadius: '50%', animation: 'spin 0.9s linear infinite', marginBottom: 14 },
  overlayTitle:    { color: '#fff', fontSize: 24, fontWeight: 700, textAlign: 'center', margin: 0, marginBottom: 6 },
  overlaySubtitle: { color: '#94a3b8', fontSize: 15, textAlign: 'center', margin: 0 },

  pipMob:   { position: 'absolute', top: 12, right: 12, width: 110, height: 145, borderRadius: 14, overflow: 'hidden', border: '2.5px solid #7c3aed', boxShadow: '0 4px 16px rgba(124,58,237,0.5)' },
  pipDesk:  { position: 'absolute', top: 20, right: 20, width: 190, height: 250, borderRadius: 16, overflow: 'hidden', border: '3px solid #7c3aed', boxShadow: '0 6px 24px rgba(124,58,237,0.5)' },
  pipVideo: { width: '100%', height: '100%', objectFit: 'contain', background: '#000' },
  pipLabel: { position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 10, whiteSpace: 'nowrap' },

  videoBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: 'linear-gradient(transparent, rgba(0,0,0,0.65))' },
  watermark:      { color: '#a855f7', fontWeight: 800, fontSize: 15, opacity: 0.9 },
  flagBtn:        { background: 'rgba(220,38,38,0.85)', border: 'none', color: 'white', borderRadius: 20, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },

  hintText:  { color: '#475569', fontSize: 15, fontWeight: 500, textAlign: 'center', marginTop: 28, lineHeight: 1.6 },
  systemMsg: { color: '#7c3aed', fontSize: 13, textAlign: 'center', fontStyle: 'italic', margin: '4px 0' },
  bubble:    { padding: '11px 15px', borderRadius: 16, maxWidth: '85%', fontSize: 14, color: '#e2e8f0', lineHeight: 1.5, wordBreak: 'break-word' },

  nextBtn: { background: '#22c55e', border: 'none', borderRadius: 14, padding: '0 26px', height: 54, fontSize: 16, fontWeight: 700, color: '#fff', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 },
  stopBtn: { background: '#ef4444', border: 'none', borderRadius: 14, width: 54, height: 54, fontSize: 19, color: '#fff', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  msgInput:{ flex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14, padding: '0 20px', height: 54, fontSize: 15, color: '#e2e8f0', outline: 'none', minWidth: 0 },
  sendBtn: { background: '#7c3aed', border: 'none', borderRadius: 14, width: 54, height: 54, fontSize: 20, color: '#fff', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },

  mobPage:    { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0a0a0f', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  mobVideoSize:{ height: '52vh', width: '100%' },
  mobChatBox: { flex: 1, margin: '12px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 18, padding: '16px 14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 9, minHeight: 0 },
  mobBar:     { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 14px 16px', flexShrink: 0, background: '#0a0a0f' },

  deskPage:     { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0a0a0f', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  deskBody:     { flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', gap: 0 },
  deskVideoSize:{ flex: '0 0 74%', height: '100%', borderRight: '1px solid #1e293b' },
  deskChatPanel:{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden', minWidth: 340 },
  deskMsgArea:  { flex: 1, padding: '24px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 },
  deskBar:      { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 26px', flexShrink: 0, background: '#060608', borderTop: '1px solid #1e293b' },
};

export default ChatPage;