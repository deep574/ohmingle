import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';

function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { gender = 'User', interests = [] } = location.state || {};

  const [status, setStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
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

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  const cleanupPeer = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(iceServers);
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
    } catch (err) { console.error('Offer handle error:', err); }
  }, [createPeerConnection]);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) { alert('Please allow camera and microphone!'); }
    };
    startCamera();

    const socket = io('http://localhost:3001', { transports: ['websocket', 'polling'], forceNew: true });
    socketRef.current = socket;

    socket.on('connect', () => console.log('✅ Connected:', socket.id));
    socket.on('onlineCount', (count) => setOnlineCount(count));
    socket.on('waiting', () => setStatus('waiting'));
    socket.on('strangerFound', async ({ role }) => {
      setStatus('connected');
      setMessages([{ text: "✨ You're now chatting with someone new", system: true }]);
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
      setMessages(prev => [...prev, { text: 'Stranger has disconnected.', system: true }]);
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

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsMuted(prev => !prev);
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
      setIsCameraOff(prev => !prev);
    }
  };

  const reportStranger = (reason) => {
    alert(`✅ Reported! Reason: "${reason}". Thank you!`);
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
    if (inputMsg.trim()) {
      if (status === 'connected') {
        socketRef.current.emit('message', { text: inputMsg });
        setMessages(prev => [...prev, { text: inputMsg, from: 'me' }]);
      } else {
        alert('Connect to a stranger first!');
      }
      setInputMsg('');
    }
  };

  const goHome = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    cleanupPeer();
    navigate('/');
  };

  // Report Modal (shared)
  const ReportModal = () => (
    <div style={shared.modalOverlay}>
      <div style={shared.modal}>
        <h3 style={shared.modalTitle}>🚩 Report Stranger</h3>
        <p style={shared.modalSub}>Why are you reporting?</p>
        {['🔞 Nudity/Sexual Content','😠 Harassment','🤖 Spam/Bot','👶 Underage','⚠️ Other'].map(r => (
          <button key={r} style={shared.modalOption} onClick={() => reportStranger(r)}>{r}</button>
        ))}
        <button style={shared.modalCancel} onClick={() => setShowReport(false)}>Cancel</button>
      </div>
    </div>
  );

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={mob.container}>
        {showReport && <ReportModal />}

        {/* ── TOP: Header ── */}
        <div style={mob.header}>
          <span style={mob.logo} onClick={goHome}>
            Ohm<span style={{ color: '#a855f7' }}>ingle</span>
          </span>
          <span style={mob.online}>● {onlineCount} online</span>
        </div>

        {/* ── MIDDLE: Stranger full video with PiP ── */}
        <div style={mob.videoWrap}>
          {/* Stranger video - full */}
          <video ref={remoteVideoRef} autoPlay playsInline style={mob.remoteVideo} />

          {/* Overlay when not connected */}
          {status !== 'connected' && (
            <div style={mob.overlay}>
              {status === 'idle' && (
                <>
                  <p style={mob.overlayEmoji}>👋</p>
                  <p style={mob.overlayText}>Tap Start to find someone!</p>
                </>
              )}
              {(status === 'searching' || status === 'waiting') && (
                <>
                  <div style={mob.spinner} />
                  <p style={mob.overlayText}>Finding stranger...</p>
                  <p style={mob.overlaySmall}>This takes a few seconds</p>
                </>
              )}
              {status === 'strangerLeft' && (
                <>
                  <p style={mob.overlayEmoji}>👋</p>
                  <p style={mob.overlayText}>Stranger left!</p>
                  <p style={mob.overlaySmall}>Tap Next to find new stranger</p>
                </>
              )}
            </div>
          )}

          {/* Stranger label bottom left */}
          <div style={mob.strangerLabel}>
            <span style={mob.greenDot}></span> Stranger
          </div>

          {/* Report button top right */}
          <button style={mob.reportBtn} onClick={() => setShowReport(true)}>🚩</button>

          {/* YOUR camera — small PiP bottom right */}
          <div style={mob.pipWrap}>
            <video ref={localVideoRef} autoPlay playsInline muted style={mob.pipVideo} />
            <span style={mob.youLabel}>You</span>
          </div>
        </div>

        {/* ── CHAT MESSAGES ── */}
        <div style={mob.chatBox}>
          {messages.length === 0 && (
            <p style={mob.noMsg}>
              {status === 'connected' ? '👋 Say hello!' : '🔍 Connect first'}
            </p>
          )}
          {messages.map((msg, i) =>
            msg.system
              ? <p key={i} style={mob.systemMsg}>{msg.text}</p>
              : (
                <div key={i} style={{
                  ...mob.bubble,
                  alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start',
                  background: msg.from === 'me' ? '#7c3aed' : '#e5e7eb',
                  color: msg.from === 'me' ? 'white' : '#111',
                }}>
                  {msg.text}
                </div>
              )
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── INPUT ROW ── */}
        <div style={mob.inputRow}>
          <button style={{ ...mob.iconBtn, fontSize: '20px', background: 'transparent', border: 'none' }}>😊</button>
          <input
            style={mob.input}
            type="text"
            placeholder="Type a message..."
            value={inputMsg}
            onChange={e => setInputMsg(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && sendMessage()}
          />
          <button style={mob.sendBtn} onClick={sendMessage}>➤</button>
        </div>

        {/* ── BOTTOM CONTROLS ── */}
        <div style={mob.controls}>
          <button
            style={{ ...mob.ctrlBtn, background: isMuted ? '#dc2626' : '#4b5563' }}
            onClick={toggleMute}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>
          <button
            style={{ ...mob.ctrlBtn, background: isCameraOff ? '#dc2626' : '#4b5563' }}
            onClick={toggleCamera}
          >
            {isCameraOff ? '📵' : '📷'}
          </button>

          {(status === 'idle' || status === 'strangerLeft') && (
            <button style={mob.startBtn} onClick={findStranger}>▶▶ Start</button>
          )}
          {(status === 'searching' || status === 'waiting' || status === 'connected') && (
            <button style={mob.nextBtn} onClick={skipStranger}>▶▶ Next</button>
          )}

          <button style={mob.stopBtn} onClick={goHome}>■</button>
        </div>
      </div>
    );
  }

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────────
  return (
    <div style={desk.container}>
      {showReport && <ReportModal />}

      {/* Left Panel */}
      <div style={desk.leftPanel}>

        {/* Stranger video top half */}
        <div style={desk.videoBox}>
          <video ref={remoteVideoRef} autoPlay playsInline style={desk.video} />
          {status !== 'connected' && (
            <div style={desk.overlay}>
              {status === 'idle' && <p style={desk.overlayText}>👋 Click Start!</p>}
              {(status === 'searching' || status === 'waiting') && (
                <div style={desk.overlayCenter}>
                  <div style={desk.spinner} />
                  <p style={desk.overlayText}>Finding stranger...</p>
                </div>
              )}
              {status === 'strangerLeft' && <p style={desk.overlayText}>Stranger left 👋</p>}
            </div>
          )}
          <div style={desk.videoLabel}>
            <span style={desk.greenDot}></span> Stranger
          </div>
          <button style={desk.reportBtn} onClick={() => setShowReport(true)}>⚑ Report</button>
        </div>

        {/* Your video bottom half */}
        <div style={desk.videoBox}>
          <video ref={localVideoRef} autoPlay playsInline muted style={desk.video} />
          <div style={desk.videoLabel}>
            <span style={desk.greenDot}></span> You ({gender})
          </div>
          <div style={desk.videoControls}>
            <button style={{ ...desk.vCtrlBtn, background: isMuted ? '#dc2626' : 'rgba(0,0,0,0.5)' }} onClick={toggleMute}>
              {isMuted ? '🔇' : '🎤'}
            </button>
            <button style={{ ...desk.vCtrlBtn, background: isCameraOff ? '#dc2626' : 'rgba(0,0,0,0.5)' }} onClick={toggleCamera}>
              {isCameraOff ? '📵' : '📷'}
            </button>
          </div>
        </div>

        {/* Controls bar */}
        <div style={desk.controlBar}>
          <span style={desk.logo} onClick={goHome}>
            Ohm<span style={{ color: '#a855f7' }}>ingle</span>
          </span>
          <span style={desk.online}>● {onlineCount} online</span>
          <div style={desk.btnRow}>
            {(status === 'idle' || status === 'strangerLeft') && (
              <button style={desk.startBtn} onClick={findStranger}>Start</button>
            )}
            {(status === 'searching' || status === 'waiting' || status === 'connected') && (
              <button style={desk.skipBtn} onClick={skipStranger}>
                Skip <span style={{ fontSize: '11px', opacity: 0.7 }}>Esc</span>
              </button>
            )}
            <button style={desk.stopBtn} onClick={goHome}>■ Stop</button>
          </div>
        </div>
      </div>

      {/* Right Panel — Chat */}
      <div style={desk.rightPanel}>
        <div style={desk.messages}>
          {messages.length === 0 && (
            <p style={desk.noMsg}>Find a stranger to start chatting</p>
          )}
          {messages.map((msg, i) =>
            msg.system
              ? <p key={i} style={desk.systemMsg}>{msg.text}</p>
              : (
                <div key={i} style={{
                  ...desk.bubble,
                  alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start',
                  background: msg.from === 'me' ? '#7c3aed' : '#f3f4f6',
                  color: msg.from === 'me' ? 'white' : '#111',
                }}>
                  {msg.text}
                </div>
              )
          )}
          <div ref={messagesEndRef} />
        </div>

        {interests.length > 0 && status === 'connected' && (
          <div style={desk.interestBar}>
            {interests.map(i => <span key={i} style={desk.interestTag}>{i}</span>)}
          </div>
        )}

        <div style={desk.inputRow}>
          <input
            style={desk.input}
            type="text"
            placeholder="Type a message..."
            value={inputMsg}
            onChange={e => setInputMsg(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && sendMessage()}
          />
          <button style={desk.sendBtn} onClick={sendMessage}>➤</button>
        </div>
      </div>
    </div>
  );
}

// ── SHARED MODAL STYLES ──────────────────────────────────────────────────────
const shared = {
  modalOverlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 },
  modal: { background:'white', borderRadius:'16px', padding:'22px', width:'290px', display:'flex', flexDirection:'column', gap:'9px', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' },
  modalTitle: { fontSize:'17px', fontWeight:'800', color:'#111', textAlign:'center', margin:0 },
  modalSub: { color:'#6b7280', fontSize:'13px', textAlign:'center', margin:0 },
  modalOption: { background:'#f3f4f6', border:'none', borderRadius:'9px', padding:'11px 14px', fontSize:'13px', cursor:'pointer', textAlign:'left', color:'#111', fontWeight:'500' },
  modalCancel: { background:'transparent', border:'1px solid #e5e7eb', borderRadius:'9px', padding:'10px', fontSize:'13px', cursor:'pointer', color:'#6b7280', marginTop:'2px' },
};

// ── MOBILE STYLES ────────────────────────────────────────────────────────────
const mob = {
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#0a0a0f',
    fontFamily: 'Segoe UI, sans-serif',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 16px',
    background: '#0a0a0f',
    flexShrink: 0,
    zIndex: 10,
    height: '44px',
  },
  logo: { fontSize: '20px', fontWeight: '900', color: 'white', cursor: 'pointer' },
  online: { color: '#10b981', fontSize: '13px', fontWeight: '700' },

  // Video section — 45% of screen height
  videoWrap: {
    flex: 1,
    position: 'relative',
    background: '#111',
    overflow: 'hidden',
    minHeight: 0,
  },
  remoteVideo: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },

  overlay: {
    position: 'absolute', inset: 0,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  },
  overlayEmoji: { fontSize: '40px', marginBottom: '8px' },
  overlayText: { color: 'white', fontSize: '18px', fontWeight: '700', textAlign: 'center', marginBottom: '4px' },
  overlaySmall: { color: '#9ca3af', fontSize: '13px', textAlign: 'center' },
  spinner: {
    width: '40px', height: '40px',
    border: '3px solid rgba(255,255,255,0.12)',
    borderTop: '3px solid #a855f7',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '12px',
  },

  strangerLabel: {
    position: 'absolute', bottom: '10px', left: '10px',
    background: 'rgba(0,0,0,0.55)',
    color: 'white', padding: '4px 10px',
    borderRadius: '20px', fontSize: '12px', fontWeight: '700',
    display: 'flex', alignItems: 'center', gap: '5px', zIndex: 3,
  },
  greenDot: {
    width: '7px', height: '7px',
    background: '#10b981', borderRadius: '50%',
    display: 'inline-block',
  },
  reportBtn: {
    position: 'absolute', top: '10px', right: '10px',
    background: 'rgba(220,38,38,0.85)',
    color: 'white', border: 'none',
    borderRadius: '50%', width: '36px', height: '36px',
    fontSize: '16px', cursor: 'pointer', zIndex: 3,
  },

  // PiP — YOUR camera small box bottom right of video
  ppipWrap: {
    position: 'absolute',
    bottom: '10px',
    right: '10px',
    width: '90px',
    height: '120px',
    borderRadius: '10px',
    overflow: 'hidden',
    border: '2px solid #a855f7',
    zIndex: 3,
    boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
  },
  pipVideo: { width: '100%', height: '100%', objectFit: 'cover' },
  youLabel: {
    position: 'absolute', bottom: '4px', left: '5px',
    fontSize: '10px', color: 'white',
    background: 'rgba(0,0,0,0.6)',
    padding: '1px 6px', borderRadius: '6px', fontWeight: '600',
  },

  // Chat messages
  chatBox: {
    height: '100px',
    overflowY: 'auto',
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    background: '#111827',
    flexShrink: 0,
  },  
  noMsg: { color: '#6b7280', textAlign: 'center', marginTop: '16px', fontSize: '13px' },
  systemMsg: { color: '#6b7280', textAlign: 'center', fontSize: '12px', padding: '2px 0' },
  bubble: {
    padding: '8px 12px', borderRadius: '18px',
    maxWidth: '80%', fontSize: '14px',
    lineHeight: 1.4, wordBreak: 'break-word',
  },

  // Input row
  inputRow: {
    display: 'flex', alignItems: 'center', gap: '8px',
    padding: '8px 12px',
    background: '#1f2937',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  iconBtn: { cursor: 'pointer', flexShrink: 0, color: '#9ca3af' },
  input: {
    flex: 1,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '22px', padding: '9px 14px',
    color: 'white', fontSize: '14px', outline: 'none',
  },
  sendBtn: {
    background: '#7c3aed', color: 'white',
    border: 'none', borderRadius: '50%',
    width: '38px', height: '38px',
    fontSize: '16px', cursor: 'pointer', flexShrink: 0,
  },

  // Bottom controls
  controls: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: '10px', padding: '10px 14px',
    background: '#111827',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    flexShrink: 0,
  },
  ctrlBtn: {
    color: 'white', border: 'none',
    borderRadius: '50%', width: '44px', height: '44px',
    fontSize: '18px', cursor: 'pointer', flexShrink: 0,
  },
  startBtn: {
    background: '#7c3aed', color: 'white',
    border: 'none', borderRadius: '24px',
    padding: '11px 28px', fontSize: '15px',
    fontWeight: '800', cursor: 'pointer',
  },
  nextBtn: {
    background: '#10b981', color: 'white',
    border: 'none', borderRadius: '24px',
    padding: '11px 28px', fontSize: '15px',
    fontWeight: '800', cursor: 'pointer',
  },
  stopBtn: {
    background: '#dc2626', color: 'white',
    border: 'none', borderRadius: '50%',
    width: '44px', height: '44px',
    fontSize: '18px', cursor: 'pointer', flexShrink: 0,
  },
};

// ── DESKTOP STYLES ───────────────────────────────────────────────────────────
const desk = {
  container: { height: '100vh', display: 'flex', background: '#fff', fontFamily: 'Segoe UI, sans-serif', overflow: 'hidden' },
  leftPanel: { width: '45%', display: 'flex', flexDirection: 'column', background: '#000', flexShrink: 0 },
  videoBox: { flex: 1, position: 'relative', overflow: 'hidden', borderBottom: '1px solid #1a1a1a' },
  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  overlay: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  overlayCenter: { textAlign: 'center' },
  overlayText: { color: 'white', fontSize: '20px', fontWeight: '700', textAlign: 'center' },
  spinner: { width: '44px', height: '44px', border: '3px solid rgba(255,255,255,0.12)', borderTop: '3px solid #a855f7', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' },
  videoLabel: { position: 'absolute', bottom: '10px', left: '12px', background: 'rgba(0,0,0,0.55)', color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' },
  greenDot: { width: '7px', height: '7px', background: '#10b981', borderRadius: '50%', display: 'inline-block' },
  reportBtn: { position: 'absolute', bottom: '10px', right: '12px', background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '20px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer' },
  videoControls: { position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '6px' },
  vCtrlBtn: { color: 'white', border: 'none', borderRadius: '50%', width: '32px', height: '32px', fontSize: '14px', cursor: 'pointer' },
  controlBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#111', flexShrink: 0 },
  logo: { fontSize: '20px', fontWeight: '900', color: 'white', cursor: 'pointer' },
  online: { color: '#10b981', fontSize: '13px', fontWeight: '700' },
  btnRow: { display: 'flex', gap: '8px', alignItems: 'center' },
  startBtn: { background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 22px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' },
  skipBtn: { background: '#374151', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 22px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' },
  stopBtn: { background: '#374151', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' },
  rightPanel: { flex: 1, display: 'flex', flexDirection: 'column', background: 'white', overflow: 'hidden' },
  messages: { flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' },
  noMsg: { color: '#9ca3af', textAlign: 'center', marginTop: '40px', fontSize: '14px' },
  systemMsg: { color: '#6b7280', textAlign: 'center', fontSize: '13px', padding: '6px 0' },
  bubble: { padding: '10px 14px', borderRadius: '18px', maxWidth: '75%', fontSize: '14px', lineHeight: 1.5, wordBreak: 'break-word' },
  interestBar: { display: 'flex', gap: '6px', padding: '8px 16px', borderTop: '1px solid #f3f4f6', flexWrap: 'wrap' },
  interestTag: { background: '#f3e8ff', color: '#7c3aed', borderRadius: '12px', padding: '3px 10px', fontSize: '12px', fontWeight: '600' },
  inputRow: { display: 'flex', gap: '8px', padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: 'white', flexShrink: 0 },
  input: { flex: 1, border: '1px solid #e5e7eb', borderRadius: '24px', padding: '10px 18px', fontSize: '14px', outline: 'none', background: '#f9fafb' },
  sendBtn: { background: '#7c3aed', color: 'white', border: 'none', borderRadius: '50%', width: '42px', height: '42px', fontSize: '18px', cursor: 'pointer', flexShrink: 0 },
};

export default ChatPage;