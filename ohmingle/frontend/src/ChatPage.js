import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';

const BACKEND_URL = ohmingle-backend-production-ff22.up.railway.app
function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { interests = [] } = location.state || {};

  const [status, setStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const socket = io(BACKEND_URL, { 
      transports: ['polling'], 
      forceNew: true,
      upgrade: false
    });
    socketRef.current = socket;

    socket.on('connect', () => console.log('✅ Connected to Railway:', socket.id));
    socket.on('onlineCount', (count) => setOnlineCount(count));
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

  const StatusOverlay = ({ isMob }) => (
    <div style={isMob ? s.mobOverlay : s.deskOverlay}>
      {status === 'idle' && <p style={isMob ? s.mobOverlayText : s.deskOverlayText}>👋 {isMob ? 'Tap' : 'Click'} Start!</p>}
      {(status === 'searching' || status === 'waiting') && (
        <div style={{ textAlign: 'center' }}>
          <div style={isMob ? s.mobSpinner : s.deskSpinner} />
          <p style={isMob ? s.mobOverlayText : s.deskOverlayText}>Finding stranger...</p>
          <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: '4px' }}>This takes a few seconds</p>
        </div>
      )}
      {status === 'strangerLeft' && <p style={isMob ? s.mobOverlayText : s.deskOverlayText}>👋 Stranger left!</p>}
    </div>
  );

  const BottomButtons = ({ isMob }) => (
    <div style={isMob ? s.mobBottomRow : s.deskBottomRow}>
      {(status === 'idle' || status === 'strangerLeft') && (
        <button style={isMob ? s.mobStartBtn : s.deskStartBtn} onClick={findStranger}>▶▶ Start</button>
      )}
      {(status === 'searching' || status === 'waiting' || status === 'connected') && (
        <button style={isMob ? s.mobSkipBtn : s.deskSkipBtn} onClick={skipStranger}>▶▶ Next</button>
      )}
      <button style={isMob ? s.mobStopBtn : s.deskStopBtn} onClick={goHome}>■</button>
      <input
        style={isMob ? s.mobInput : s.deskInput}
        type="text"
        placeholder="Type message..."
        value={inputMsg}
        onChange={e => setInputMsg(e.target.value)}
        onKeyPress={e => e.key === 'Enter' && sendMessage()}
      />
      <button style={isMob ? s.mobSendBtn : s.deskSendBtn} onClick={sendMessage}>➤</button>
    </div>
  );

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={s.mobContainer}>
        {showReport && <ReportModal />}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        <div style={s.mobHeader}>
          <span style={s.mobLogo} onClick={goHome}>Ohm<span style={{ color: '#7c3aed' }}>ingle</span></span>
          <span style={s.mobOnline}>● {onlineCount} online</span>
        </div>

        <div style={s.mobVideoBox}>
          <video ref={remoteVideoRef} autoPlay playsInline style={s.mobRemoteVideo} />
          {status !== 'connected' && <StatusOverlay isMob={true} />}
          <div style={s.mobPip}>
            <video ref={localVideoRef} autoPlay playsInline muted style={s.fullVideo} />
          </div>
          <div style={s.mobVideoBar}>
            <span style={s.mobBrand}>Ohmingle.com</span>
            <button style={s.flagBtn} onClick={() => setShowReport(true)}>🚩</button>
          </div>
        </div>

        <div style={s.mobChat}>
          {messages.length === 0 && (
            <p style={s.hintText}>
              {status === 'idle' ? 'Tap Start to find someone 👇' :
               status === 'searching' || status === 'waiting' ? 'Searching...' :
               status === 'connected' ? 'Say hello! 👋' : 'Stranger left. Tap Start again.'}
            </p>
          )}
          {messages.map((msg, i) =>
            msg.system
              ? <p key={i} style={s.systemMsg}>{msg.text}</p>
              : <div key={i} style={{ ...s.bubble, alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start', background: msg.from === 'me' ? '#7c3aed' : '#1e293b' }}>{msg.text}</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <BottomButtons isMob={true} />
      </div>
    );
  }

  // ── DESKTOP ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.deskContainer}>
      {showReport && <ReportModal />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={s.deskHeader}>
        <span style={s.deskLogo} onClick={goHome}>Ohm<span style={{ color: '#7c3aed' }}>ingle</span></span>
        <span style={s.deskOnline}>● {onlineCount} online</span>
      </div>

      <div style={s.deskBody}>
        {/* Left: Video */}
        <div style={s.deskVideoBox}>
          <video ref={remoteVideoRef} autoPlay playsInline style={s.deskRemoteVideo} />
          {status !== 'connected' && <StatusOverlay isMob={false} />}
          <div style={s.deskPip}>
            <video ref={localVideoRef} autoPlay playsInline muted style={s.fullVideo} />
          </div>
          <div style={s.deskVideoBar}>
            <span style={s.deskBrand}>Ohmingle.com</span>
            <button style={s.flagBtn} onClick={() => setShowReport(true)}>🚩</button>
          </div>
        </div>

        {/* Right: Chat */}
        <div style={s.deskChatPanel}>
          <div style={s.deskMessages}>
            {messages.length === 0 && (
              <p style={s.hintText}>
                {status === 'idle' ? 'Click Start to find someone 👇' :
                 status === 'searching' || status === 'waiting' ? 'Searching for a stranger...' :
                 status === 'connected' ? 'Say hello! 👋' : 'Stranger left. Click Start again.'}
              </p>
            )}
            {messages.map((msg, i) =>
              msg.system
                ? <p key={i} style={s.systemMsg}>{msg.text}</p>
                : <div key={i} style={{ ...s.bubble, alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start', background: msg.from === 'me' ? '#7c3aed' : '#1e293b' }}>{msg.text}</div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      <BottomButtons isMob={false} />
    </div>
  );
}

const s = {
  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal: { background: '#1e293b', borderRadius: '20px', padding: '24px', width: '300px', display: 'flex', flexDirection: 'column', gap: '10px' },
  modalTitle: { fontSize: '18px', fontWeight: '800', color: 'white', textAlign: 'center', margin: 0 },
  modalSub: { color: '#94a3b8', fontSize: '13px', textAlign: 'center', margin: 0 },
  modalOption: { background: '#0f172a', border: '1px solid #334155', borderRadius: '10px', padding: '12px 16px', fontSize: '14px', cursor: 'pointer', textAlign: 'left', color: 'white' },
  modalCancel: { background: 'transparent', border: '1px solid #334155', borderRadius: '10px', padding: '10px', fontSize: '13px', cursor: 'pointer', color: '#64748b' },

  // Shared
  fullVideo: { width: '100%', height: '100%', objectFit: 'cover' },
  flagBtn: { background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer' },
  hintText: { color: '#64748b', fontSize: '15px', fontWeight: '500', textAlign: 'center', marginTop: '20px' },
  systemMsg: { color: '#7c3aed', fontSize: '13px', textAlign: 'center', fontStyle: 'italic' },
  bubble: { padding: '10px 16px', borderRadius: '18px', maxWidth: '80%', fontSize: '14px', color: 'white', lineHeight: 1.5, wordBreak: 'break-word' },

  // ── MOBILE ──
  mobContainer: { position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#0a0a0f', fontFamily: 'Segoe UI, sans-serif', overflow: 'hidden' },
  mobHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', flexShrink: 0 },
  mobLogo: { fontSize: '26px', fontWeight: '900', color: 'white', cursor: 'pointer' },
  mobOnline: { color: '#22c55e', fontSize: '13px', fontWeight: '600' },

  mobVideoBox: { flex: '0 0 45vh', position: 'relative', background: '#111', margin: '0 12px', borderRadius: '16px', overflow: 'hidden' },
  mobRemoteVideo: { width: '100%', height: '100%', objectFit: 'cover' },
  mobOverlay: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  mobOverlayText: { color: 'white', fontSize: '20px', fontWeight: '700' },
  mobSpinner: { width: '48px', height: '48px', border: '4px solid rgba(255,255,255,0.1)', borderTop: '4px solid #7c3aed', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: '12px' },
  mobPip: { position: 'absolute', top: '12px', right: '12px', width: '80px', height: '80px', borderRadius: '12px', overflow: 'hidden', border: '2px solid white', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' },
  mobVideoBar: { position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' },
  mobBrand: { color: '#c4b5fd', fontWeight: '800', fontSize: '13px' },

  mobChat: { flex: 1, margin: '10px 12px', background: '#0f172a', borderRadius: '16px', padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 },

  mobBottomRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px 16px', flexShrink: 0 },
  mobStartBtn: { background: '#22c55e', border: 'none', borderRadius: '14px', padding: '14px 16px', fontSize: '14px', fontWeight: '700', color: 'white', cursor: 'pointer', flexShrink: 0 },
  mobSkipBtn: { background: '#22c55e', border: 'none', borderRadius: '14px', padding: '14px 16px', fontSize: '14px', fontWeight: '700', color: 'white', cursor: 'pointer', flexShrink: 0 },
  mobStopBtn: { background: '#ef4444', border: 'none', borderRadius: '14px', width: '48px', height: '48px', fontSize: '16px', color: 'white', cursor: 'pointer', flexShrink: 0 },
  mobInput: { flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '14px', padding: '14px', fontSize: '14px', color: 'white', outline: 'none', minWidth: 0 },
  mobSendBtn: { background: '#7c3aed', border: 'none', borderRadius: '14px', width: '48px', height: '48px', fontSize: '18px', color: 'white', cursor: 'pointer', flexShrink: 0 },

  // ── DESKTOP ──
  deskContainer: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#0a0a0f', fontFamily: 'Segoe UI, sans-serif', overflow: 'hidden' },
  deskHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 32px', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' },
  deskLogo: { fontSize: '30px', fontWeight: '900', color: 'white', cursor: 'pointer' },
  deskOnline: { color: '#22c55e', fontSize: '15px', fontWeight: '600' },

  deskBody: { flex: 1, display: 'flex', gap: '20px', padding: '20px 32px', overflow: 'hidden', minHeight: 0 },

  deskVideoBox: { flex: '0 0 58%', position: 'relative', background: '#111', borderRadius: '20px', overflow: 'hidden' },
  deskRemoteVideo: { width: '100%', height: '100%', objectFit: 'cover' },
  deskOverlay: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  deskOverlayText: { color: 'white', fontSize: '26px', fontWeight: '700', marginTop: '12px' },
  deskSpinner: { width: '60px', height: '60px', border: '4px solid rgba(255,255,255,0.1)', borderTop: '4px solid #7c3aed', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  deskPip: { position: 'absolute', top: '16px', right: '16px', width: '160px', height: '120px', borderRadius: '14px', overflow: 'hidden', border: '2px solid white', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' },
  deskVideoBar: { position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' },
  deskBrand: { color: '#c4b5fd', fontWeight: '800', fontSize: '16px' },

  deskChatPanel: { flex: 1, background: '#0f172a', borderRadius: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  deskMessages: { flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' },

  deskBottomRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 32px 20px', flexShrink: 0 },
  deskStartBtn: { background: '#22c55e', border: 'none', borderRadius: '16px', padding: '16px 28px', fontSize: '16px', fontWeight: '700', color: 'white', cursor: 'pointer', flexShrink: 0 },
  deskSkipBtn: { background: '#22c55e', border: 'none', borderRadius: '16px', padding: '16px 28px', fontSize: '16px', fontWeight: '700', color: 'white', cursor: 'pointer', flexShrink: 0 },
  deskStopBtn: { background: '#ef4444', border: 'none', borderRadius: '16px', width: '56px', height: '56px', fontSize: '20px', color: 'white', cursor: 'pointer', flexShrink: 0 },
  deskInput: { flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '16px', padding: '16px 20px', fontSize: '15px', color: 'white', outline: 'none' },
  deskSendBtn: { background: '#7c3aed', border: 'none', borderRadius: '16px', width: '56px', height: '56px', fontSize: '20px', color: 'white', cursor: 'pointer', flexShrink: 0 },
};

export default ChatPage;