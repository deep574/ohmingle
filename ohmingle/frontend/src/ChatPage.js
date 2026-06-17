import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import io from 'socket.io-client';

function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { interests = [] } = location.state || {};

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

  // ── MOBILE LAYOUT (Omegle-style) ──────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={s.mobContainer}>
        {showReport && <ReportModal />}

        {/* Header */}
        <div style={s.mobHeader}>
          <span style={s.mobLogo} onClick={goHome}>
            Ohm<span style={{ color: '#7c3aed' }}>ingle</span>
          </span>
          <span style={s.mobOnline}>{onlineCount}+</span>
        </div>

        {/* Video Box - Fixed height like Omegle */}
        <div style={s.mobVideoBox}>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={s.mobRemoteVideo}
          />

          {status !== 'connected' && (
            <div style={s.mobOverlay}>
              {status === 'idle' && (
                <p style={s.mobOverlayText}>👋 Tap Start!</p>
              )}
              {(status === 'searching' || status === 'waiting') && (
                <div style={s.mobSpinner} />
              )}
              {status === 'strangerLeft' && (
                <p style={s.mobOverlayText}>Stranger left!</p>
              )}
            </div>
          )}

          {/* Your camera - small top right corner */}
          <div style={s.mobPip}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={s.mobPipVideo}
            />
          </div>

          {/* Bottom bar inside video */}
          <div style={s.mobVideoBottom}>
            <span style={s.mobBrand}>Ohmingle.com</span>
            <button
              style={s.mobFlagBtn}
              onClick={() => setShowReport(true)}
            >
              🚩
            </button>
          </div>
        </div>

        {/* Chat Area */}
        <div style={s.mobChatArea}>
          {messages.length === 0 && (
            <p style={s.mobSearchingText}>
              {status === 'idle' && 'Tap Start to find someone.'}
              {(status === 'searching' || status === 'waiting') && 'Searching for someone to chat with.'}
              {status === 'connected' && 'Say hello! 👋'}
              {status === 'strangerLeft' && 'Stranger disconnected.'}
            </p>
          )}
          {messages.map((msg, i) =>
            msg.system ? (
              <p key={i} style={s.mobSystemMsg}>{msg.text}</p>
            ) : (
              <div key={i} style={{
                ...s.mobBubble,
                alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start',
                background: msg.from === 'me' ? '#7c3aed' : '#1f2937',
                color: 'white',
              }}>
                {msg.text}
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Row */}
        <div style={s.mobBottomRow}>
          {(status === 'idle' || status === 'strangerLeft') && (
            <button style={s.mobSkipBtn} onClick={findStranger}>
              Start
            </button>
          )}
          {(status === 'searching' || status === 'waiting' || status === 'connected') && (
            <button style={s.mobSkipBtn} onClick={skipStranger}>
              Skip
            </button>
          )}

          <button style={s.mobStopBtn} onClick={goHome}>■</button>

          <input
            style={s.mobBottomInput}
            type="text"
            placeholder="Type message..."
            value={inputMsg}
            onChange={e => setInputMsg(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && sendMessage()}
          />
          <button style={s.mobSendArrow} onClick={sendMessage}>➤</button>
        </div>

      </div>
    );
  }

  // ── DESKTOP LAYOUT (Same Omegle-style, bigger) ──────────────────────────────
  return (
    <div style={s.deskContainer}>
      {showReport && <ReportModal />}

      {/* Header */}
      <div style={s.deskHeader}>
        <span style={s.deskLogo} onClick={goHome}>
          Ohm<span style={{ color: '#7c3aed' }}>ingle</span>
        </span>
        <span style={s.deskOnline}>{onlineCount}+</span>
      </div>

      <div style={s.deskMain}>
        {/* Video Box */}
        <div style={s.deskVideoBox}>
          <video ref={remoteVideoRef} autoPlay playsInline style={s.deskRemoteVideo} />

          {status !== 'connected' && (
            <div style={s.deskOverlay}>
              {status === 'idle' && <p style={s.deskOverlayText}>👋 Click Start!</p>}
              {(status === 'searching' || status === 'waiting') && (
                <div style={s.deskOverlayCenter}>
                  <div style={s.deskSpinner} />
                  <p style={s.deskOverlayText}>Finding stranger...</p>
                </div>
              )}
              {status === 'strangerLeft' && <p style={s.deskOverlayText}>Stranger left 👋</p>}
            </div>
          )}

          <div style={s.deskPip}>
            <video ref={localVideoRef} autoPlay playsInline muted style={s.deskPipVideo} />
          </div>

          <div style={s.deskVideoBottom}>
            <span style={s.deskBrand}>Ohmingle.com</span>
            <button style={s.deskFlagBtn} onClick={() => setShowReport(true)}>🚩</button>
          </div>
        </div>

        {/* Chat Area */}
        <div style={s.deskChatArea}>
          <div style={s.deskMessages}>
            {messages.length === 0 && (
              <p style={s.deskSearchingText}>
                {status === 'idle' && 'Click Start to find someone.'}
                {(status === 'searching' || status === 'waiting') && 'Searching for someone to chat with.'}
                {status === 'connected' && 'Say hello! 👋'}
                {status === 'strangerLeft' && 'Stranger disconnected.'}
              </p>
            )}
            {messages.map((msg, i) =>
              msg.system ? (
                <p key={i} style={s.deskSystemMsg}>{msg.text}</p>
              ) : (
                <div key={i} style={{
                  ...s.deskBubble,
                  alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start',
                  background: msg.from === 'me' ? '#7c3aed' : '#1f2937',
                  color: 'white',
                }}>
                  {msg.text}
                </div>
              )
            )}
            <div ref={messagesEndRef} />
          </div>

          {interests.length > 0 && status === 'connected' && (
            <div style={s.deskInterestBar}>
              {interests.map(i => <span key={i} style={s.deskInterestTag}>{i}</span>)}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div style={s.deskBottomRow}>
        {(status === 'idle' || status === 'strangerLeft') && (
          <button style={s.deskSkipBtn} onClick={findStranger}>Start</button>
        )}
        {(status === 'searching' || status === 'waiting' || status === 'connected') && (
          <button style={s.deskSkipBtn} onClick={skipStranger}>Skip</button>
        )}
        <button style={s.deskStopBtn} onClick={goHome}>■</button>
        <input
          style={s.deskBottomInput}
          type="text"
          placeholder="Type message..."
          value={inputMsg}
          onChange={e => setInputMsg(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && sendMessage()}
        />
        <button style={s.deskSendArrow} onClick={sendMessage}>➤</button>
      </div>
    </div>
  );
}

// ── ALL STYLES ──────────────────────────────────────────────────────────────
const s = {

  // Modal (shared)
  modalOverlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 },
  modal: { background:'white', borderRadius:'16px', padding:'22px', width:'290px', display:'flex', flexDirection:'column', gap:'9px', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' },
  modalTitle: { fontSize:'17px', fontWeight:'800', color:'#111', textAlign:'center', margin:0 },
  modalSub: { color:'#6b7280', fontSize:'13px', textAlign:'center', margin:0 },
  modalOption: { background:'#f3f4f6', border:'none', borderRadius:'9px', padding:'11px 14px', fontSize:'13px', cursor:'pointer', textAlign:'left', color:'#111', fontWeight:'500' },
  modalCancel: { background:'transparent', border:'1px solid #e5e7eb', borderRadius:'9px', padding:'10px', fontSize:'13px', cursor:'pointer', color:'#6b7280', marginTop:'2px' },

  // ── MOBILE STYLES (Omegle-style) ──
  mobContainer: {
    position: 'fixed',
    top: 0, left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#0a0a0f',
    fontFamily: 'Segoe UI, sans-serif',
    overflow: 'hidden',
  },
  mobHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    background: '#0a0a0f',
    flexShrink: 0,
  },
  mobLogo: {
    fontSize: '24px',
    fontWeight: '900',
    color: 'white',
    cursor: 'pointer',
  },
  mobOnline: {
    color: '#7c3aed',
    fontSize: '18px',
    fontWeight: '800',
  },

  mobVideoBox: {
    height: '38vh',
    minHeight: '260px',
    maxHeight: '340px',
    position: 'relative',
    background: '#1a1a1a',
    margin: '0 12px',
    borderRadius: '14px',
    overflow: 'hidden',
    flexShrink: 0,
  },
  mobRemoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  mobOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobOverlayText: {
    color: 'white',
    fontSize: '17px',
    fontWeight: '600',
  },
  mobSpinner: {
    width: '44px',
    height: '44px',
    border: '3px solid rgba(255,255,255,0.15)',
    borderTop: '3px solid #7c3aed',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  mobPip: {
    position: 'absolute',
    top: '10px',
    right: '10px',
    width: '70px',
    height: '70px',
    borderRadius: '10px',
    overflow: 'hidden',
    border: '2px solid white',
  },
  mobPipVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  mobVideoBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    background: 'rgba(0,0,0,0.3)',
  },
  mobBrand: {
    color: '#c4b5fd',
    fontWeight: '800',
    fontSize: '14px',
  },
  mobFlagBtn: {
    background: 'transparent',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
  },

  mobChatArea: {
    flex: 1,
    margin: '12px',
    background: '#111827',
    borderRadius: '14px',
    padding: '16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    minHeight: 0,
  },
  mobSearchingText: {
    color: '#9ca3af',
    fontSize: '16px',
    fontWeight: '600',
  },
  mobSystemMsg: {
    color: '#6b7280',
    fontSize: '13px',
    textAlign: 'center',
  },
  mobBubble: {
    padding: '10px 14px',
    borderRadius: '16px',
    maxWidth: '80%',
    fontSize: '14px',
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },

  mobBottomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 12px 12px 12px',
    flexShrink: 0,
  },
  mobSkipBtn: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '12px',
    padding: '14px 18px',
    fontSize: '15px',
    fontWeight: '700',
    color: 'white',
    cursor: 'pointer',
    flexShrink: 0,
  },
  mobStopBtn: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '12px',
    width: '50px',
    height: '50px',
    fontSize: '16px',
    color: 'white',
    cursor: 'pointer',
    flexShrink: 0,
  },
  mobBottomInput: {
    flex: 1,
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '12px',
    padding: '14px',
    fontSize: '14px',
    outline: 'none',
    color: 'white',
    minWidth: 0,
  },
  mobSendArrow: {
    background: '#7c3aed',
    border: 'none',
    borderRadius: '12px',
    width: '50px',
    height: '50px',
    fontSize: '16px',
    color: 'white',
    cursor: 'pointer',
    flexShrink: 0,
  },

  // ── DESKTOP STYLES (Same Omegle-style, bigger) ──
  deskContainer: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#0a0a0f',
    fontFamily: 'Segoe UI, sans-serif',
    overflow: 'hidden',
  },
  deskHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 30px',
    background: '#0a0a0f',
    flexShrink: 0,
  },
  deskLogo: { fontSize: '26px', fontWeight: '900', color: 'white', cursor: 'pointer' },
  deskOnline: { color: '#7c3aed', fontSize: '20px', fontWeight: '800' },
  deskMain: {
    flex: 1,
    display: 'flex',
    gap: '16px',
    padding: '0 24px',
    overflow: 'hidden',
    minHeight: 0,
  },
  deskVideoBox: {
    flex: 1,
    position: 'relative',
    background: '#1a1a1a',
    borderRadius: '16px',
    overflow: 'hidden',
  },
  deskRemoteVideo: { width: '100%', height: '100%', objectFit: 'cover' },
  deskOverlay: {
    position: 'absolute', inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
  },
  deskOverlayCenter: { textAlign: 'center' },
  deskOverlayText: { color: 'white', fontSize: '22px', fontWeight: '700' },
  deskSpinner: {
    width: '50px', height: '50px',
    border: '3px solid rgba(255,255,255,0.15)',
    borderTop: '3px solid #7c3aed',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 14px',
  },
  deskPip: {
    position: 'absolute', top: '16px', right: '16px',
    width: '140px', height: '105px',
    borderRadius: '12px', overflow: 'hidden',
    border: '2px solid white',
  },
  deskPipVideo: { width: '100%', height: '100%', objectFit: 'cover' },
  deskVideoBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 18px',
    background: 'rgba(0,0,0,0.3)',
  },
  deskBrand: { color: '#c4b5fd', fontWeight: '800', fontSize: '16px' },
  deskFlagBtn: { background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer' },
  deskChatArea: {
    width: '380px',
    background: '#111827',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  deskMessages: {
    flex: 1,
    padding: '20px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  deskSearchingText: { color: '#9ca3af', fontSize: '16px', fontWeight: '600' },
  deskSystemMsg: { color: '#6b7280', fontSize: '13px', textAlign: 'center' },
  deskBubble: {
    padding: '10px 16px',
    borderRadius: '16px',
    maxWidth: '85%',
    fontSize: '14px',
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  deskInterestBar: {
    display: 'flex', gap: '6px',
    padding: '12px 20px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexWrap: 'wrap',
  },
  deskInterestTag: {
    background: 'rgba(124,58,237,0.15)',
    color: '#a78bfa',
    borderRadius: '12px',
    padding: '3px 10px',
    fontSize: '12px',
    fontWeight: '600',
  },
  deskBottomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '16px 24px',
    flexShrink: 0,
  },
  deskSkipBtn: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '12px',
    padding: '14px 26px',
    fontSize: '16px',
    fontWeight: '700',
    color: 'white',
    cursor: 'pointer',
  },
  deskStopBtn: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '12px',
    width: '52px', height: '52px',
    fontSize: '18px',
    color: 'white',
    cursor: 'pointer',
  },
  deskBottomInput: {
    flex: 1,
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '12px',
    padding: '15px',
    fontSize: '15px',
    color: 'white',
    outline: 'none',
  },
  deskSendArrow: {
    background: '#7c3aed',
    border: 'none',
    borderRadius: '12px',
    width: '52px', height: '52px',
    fontSize: '18px',
    color: 'white',
    cursor: 'pointer',
  },
};

export default ChatPage;