import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';

function ChatPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle');
  const [messages, setMessages] = useState([]);
  const [inputMsg, setInputMsg] = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isMobile, setIsMobile] = useState(true);

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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true, audio: true
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) { alert('Please allow camera and microphone!'); }
    };
    startCamera();

    const socket = io('http://localhost:3001', {
      transports: ['websocket', 'polling'],
      forceNew: true
    });
    socketRef.current = socket;

    socket.on('connect', () => console.log('✅ Connected:', socket.id));
    socket.on('onlineCount', (count) => setOnlineCount(count));
    socket.on('waiting', () => setStatus('waiting'));
    socket.on('strangerFound', async ({ role }) => {
      setStatus('connected');
      setMessages([{
        text: "✨ Connected! Say hello!",
        system: true
      }]);
      if (role === 'caller') await createOffer();
    });
    socket.on('offer', async (offer) => await handleOffer(offer));
    socket.on('answer', async (answer) => {
      if (peerConnectionRef.current)
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
    });
    socket.on('iceCandidate', async (candidate) => {
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        } catch (e) {}
      }
    });
    socket.on('message', (data) => {
      setMessages(prev => [...prev, { text: data.text, from: 'stranger' }]);
    });
    socket.on('strangerLeft', () => {
      setStatus('strangerLeft');
      cleanupPeer();
      setMessages(prev => [...prev, {
        text: 'Stranger disconnected.',
        system: true
      }]);
    });

    return () => {
      socket.disconnect();
      cleanupPeer();
      if (localStreamRef.current)
        localStreamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [createOffer, handleOffer, cleanupPeer]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => {
        t.enabled = !t.enabled;
      });
      setIsMuted(prev => !prev);
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => {
        t.enabled = !t.enabled;
      });
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
    if (localStreamRef.current)
      localStreamRef.current.getTracks().forEach(t => t.stop());
    cleanupPeer();
    navigate('/');
  };

  // Report Modal
  const ReportModal = () => (
    <div style={s.modalOverlay}>
      <div style={s.modal}>
        <h3 style={s.modalTitle}>🚩 Report Stranger</h3>
        <p style={s.modalSub}>Why are you reporting?</p>
        {[
          '🔞 Nudity/Sexual Content',
          '😠 Harassment',
          '🤖 Spam/Bot',
          '👶 Underage',
          '⚠️ Other'
        ].map(r => (
          <button
            key={r}
            style={s.modalOption}
            onClick={() => reportStranger(r)}
          >
            {r}
          </button>
        ))}
        <button
          style={s.modalCancel}
          onClick={() => setShowReport(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  // ── MOBILE LAYOUT ──
  if (isMobile) {
    return (
      <div style={s.mobContainer}>
        {showReport && <ReportModal />}

        {/* Header */}
        <div style={s.mobHeader}>
          <span style={s.mobLogo} onClick={goHome}>
            Ohm<span style={{ color: '#a855f7' }}>ingle</span>
          </span>
          <span style={s.mobOnline}>● {onlineCount} online</span>
        </div>

        {/* Video Area - Takes most screen */}
        <div style={s.mobVideoWrap}>

          {/* Stranger Video - Full */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={s.mobRemoteVideo}
          />

          {/* Overlay */}
          {status !== 'connected' && (
            <div style={s.mobOverlay}>
              {status === 'idle' && (
                <div style={s.mobOverlayContent}>
                  <p style={s.mobOverlayEmoji}>👋</p>
                  <p style={s.mobOverlayText}>Tap Start!</p>
                </div>
              )}
              {(status === 'searching' || status === 'waiting') && (
                <div style={s.mobOverlayContent}>
                  <div style={s.mobSpinner} />
                  <p style={s.mobOverlayText}>Finding stranger...</p>
                </div>
              )}
              {status === 'strangerLeft' && (
                <div style={s.mobOverlayContent}>
                  <p style={s.mobOverlayEmoji}>👋</p>
                  <p style={s.mobOverlayText}>Stranger left!</p>
                  <p style={s.mobOverlaySmall}>Tap Next for new stranger</p>
                </div>
              )}
            </div>
          )}

          {/* Stranger Label */}
          <div style={s.mobStrangerLabel}>● Stranger</div>

          {/* Report Button */}
          <button
            style={s.mobReportBtn}
            onClick={() => setShowReport(true)}
          >
            🚩
          </button>

          {/* YOUR Video - Small PiP */}
          <div style={s.mobPipWrap}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={s.mobPipVideo}
            />
            <span style={s.mobYouLabel}>You</span>
          </div>

        </div>

        {/* Chat Messages */}
        <div style={s.mobChatBox}>
          {messages.length === 0 && (
            <p style={s.mobNoMsg}>
              {status === 'connected'
                ? '👋 Say hello!'
                : '🔍 Find stranger first'}
            </p>
          )}
          {messages.map((msg, i) =>
            msg.system ? (
              <p key={i} style={s.mobSystemMsg}>{msg.text}</p>
            ) : (
              <div key={i} style={{
                ...s.mobBubble,
                alignSelf: msg.from === 'me' ? 'flex-end' : 'flex-start',
                background: msg.from === 'me' ? '#7c3aed' : '#374151',
                color: 'white',
              }}>
                {msg.text}
              </div>
            )
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={s.mobInputRow}>
          <input
            style={s.mobInput}
            type="text"
            placeholder="Type message..."
            value={inputMsg}
            onChange={e => setInputMsg(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && sendMessage()}
          />
          <button style={s.mobSendBtn} onClick={sendMessage}>➤</button>
        </div>

        {/* Controls */}
        <div style={s.mobControls}>
          <button
            style={{
              ...s.mobCtrlBtn,
              background: isMuted ? '#dc2626' : '#4b5563'
            }}
            onClick={toggleMute}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>

          <button
            style={{
              ...s.mobCtrlBtn,
              background: isCameraOff ? '#dc2626' : '#4b5563'
            }}
            onClick={toggleCamera}
          >
            {isCameraOff ? '📵' : '📷'}
          </button>

          {(status === 'idle' || status === 'strangerLeft') && (
            <button style={s.mobStartBtn} onClick={findStranger}>
              ▶ Start
            </button>
          )}
          {(status === 'searching' ||
            status === 'waiting' ||
            status === 'connected') && (
            <button style={s.mobNextBtn} onClick={skipStranger}>
              ▶▶ Next
            </button>
          )}

          <button style={s.mobStopBtn} onClick={goHome}>■</button>
        </div>

      </div>
    );
  }

  // ── DESKTOP LAYOUT ──
  return (
    <div style={s.deskContainer}>
      {showReport && <ReportModal />}

      {/* Left Panel - Videos */}
      <div style={s.deskLeft}>

        {/* Stranger Video */}
        <div style={s.deskVideoBox}>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={s.deskVideo}
          />
          {status !== 'connected' && (
            <div style={s.deskOverlay}>
              {status === 'idle' && (
                <p style={s.deskOverlayText}>👋 Click Start!</p>
              )}
              {(status === 'searching' || status === 'waiting') && (
                <div style={{ textAlign: 'center' }}>
                  <div style={s.deskSpinner} />
                  <p style={s.deskOverlayText}>Finding stranger...</p>
                </div>
              )}
              {status === 'strangerLeft' && (
                <p style={s.deskOverlayText}>Stranger left 👋</p>
              )}
            </div>
          )}
          <div style={s.deskVideoLabel}>● Stranger</div>
          <button
            style={s.deskReportBtn}
            onClick={() => setShowReport(true)}
          >
            ⚑ Report
          </button>
        </div>

        {/* Your Video */}
        <div style={s.deskVideoBox}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={s.deskVideo}
          />
          <div style={s.deskVideoLabel}>● You</div>
          <div style={s.deskVideoControls}>
            <button
              style={{
                ...s.deskVCtrlBtn,
                background: isMuted ? '#dc2626' : 'rgba(0,0,0,0.5)'
              }}
              onClick={toggleMute}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
            <button
              style={{
                ...s.deskVCtrlBtn,
                background: isCameraOff ? '#dc2626' : 'rgba(0,0,0,0.5)'
              }}
              onClick={toggleCamera}
            >
              {isCameraOff ? '📵' : '📷'}
            </button>
          </div>
        </div>

        {/* Control Bar */}
        <div style={s.deskControlBar}>
          <span style={s.deskLogo} onClick={goHome}>
            Ohm<span style={{ color: '#a855f7' }}>ingle</span>
          </span>
          <span style={s.deskOnline}>● {onlineCount} online</span>
          <div style={s.deskBtnRow}>
            {(status === 'idle' || status === 'strangerLeft') && (
              <button style={s.deskStartBtn} onClick={findStranger}>
                Start
              </button>
            )}
            {(status === 'searching' ||
              status === 'waiting' ||
              status === 'connected') && (
              <button style={s.deskSkipBtn} onClick={skipStranger}>
                Next
              </button>
            )}
            <button style={s.deskStopBtn} onClick={goHome}>
              ■ Stop
            </button>
          </div>
        </div>

      </div>

      {/* Right Panel - Chat */}
      <div style={s.deskRight}>
        <div style={s.deskMessages}>
          {messages.length === 0 && (
            <p style={s.deskNoMsg}>
              Find a stranger to start chatting
            </p>
          )}
          {messages.map((msg, i) =>
            msg.system ? (
              <p key={i} style={s.deskSystemMsg}>{msg.text}</p>
            ) : (
              <div key={i} style={{
                ...s.deskBubble,
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

        <div style={s.deskInputRow}>
          <input
            style={s.deskInput}
            type="text"
            placeholder="Type a message..."
            value={inputMsg}
            onChange={e => setInputMsg(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && sendMessage()}
          />
          <button style={s.deskSendBtn} onClick={sendMessage}>➤</button>
        </div>
      </div>

    </div>
  );
}

// ── ALL STYLES ──
const s = {

  // Modal
  modalOverlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center',
    justifyContent: 'center', zIndex: 9999
  },
  modal: {
    background: 'white', borderRadius: '16px',
    padding: '22px', width: '290px',
    display: 'flex', flexDirection: 'column',
    gap: '9px'
  },
  modalTitle: {
    fontSize: '17px', fontWeight: '800',
    color: '#111', textAlign: 'center', margin: 0
  },
  modalSub: {
    color: '#6b7280', fontSize: '13px',
    textAlign: 'center', margin: 0
  },
  modalOption: {
    background: '#f3f4f6', border: 'none',
    borderRadius: '9px', padding: '11px 14px',
    fontSize: '13px', cursor: 'pointer',
    textAlign: 'left', color: '#111', fontWeight: '500'
  },
  modalCancel: {
    background: 'transparent',
    border: '1px solid #e5e7eb',
    borderRadius: '9px', padding: '10px',
    fontSize: '13px', cursor: 'pointer', color: '#6b7280'
  },

  // ── MOBILE STYLES ──
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
    padding: '8px 16px',
    background: '#0a0a0f',
    height: '44px',
    flexShrink: 0,
    zIndex: 10,
  },
  mobLogo: {
    fontSize: '20px', fontWeight: '900',
    color: 'white', cursor: 'pointer'
  },
  mobOnline: {
    color: '#10b981', fontSize: '13px', fontWeight: '700'
  },

  // Video takes ALL remaining space
  mobVideoWrap: {
    flex: 1,
    position: 'relative',
    background: '#111',
    overflow: 'hidden',
    minHeight: 0,
  },
  mobRemoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  mobOverlay: {
    position: 'absolute', inset: 0,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  },
  mobOverlayContent: { textAlign: 'center' },
  mobOverlayEmoji: { fontSize: '50px', marginBottom: '10px' },
  mobOverlayText: {
    color: 'white', fontSize: '20px',
    fontWeight: '700', marginBottom: '6px'
  },
  mobOverlaySmall: { color: '#9ca3af', fontSize: '13px' },
  mobSpinner: {
    width: '44px', height: '44px',
    border: '3px solid rgba(255,255,255,0.1)',
    borderTop: '3px solid #a855f7',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 12px',
  },
  mobStrangerLabel: {
    position: 'absolute', bottom: '12px', left: '12px',
    background: 'rgba(0,0,0,0.6)',
    color: '#10b981', padding: '4px 12px',
    borderRadius: '20px', fontSize: '12px',
    fontWeight: '700', zIndex: 3,
  },
  mobReportBtn: {
    position: 'absolute', top: '10px', right: '10px',
    background: 'rgba(220,38,38,0.85)',
    color: 'white', border: 'none',
    borderRadius: '50%', width: '36px', height: '36px',
    fontSize: '16px', cursor: 'pointer', zIndex: 3,
  },

  // PiP - Your small video inside stranger video
  mobPipWrap: {
    position: 'absolute',
    bottom: '12px', right: '12px',
    width: '90px', height: '120px',
    borderRadius: '10px', overflow: 'hidden',
    border: '2px solid #a855f7',
    zIndex: 3,
  },
  mobPipVideo: {
    width: '100%', height: '100%', objectFit: 'cover'
  },
  mobYouLabel: {
    position: 'absolute', bottom: '4px', left: '6px',
    fontSize: '10px', color: 'white',
    background: 'rgba(0,0,0,0.6)',
    padding: '1px 6px', borderRadius: '6px', fontWeight: '600',
  },

  // Chat - Fixed small height
  mobChatBox: {
    height: '110px',
    overflowY: 'auto',
    padding: '8px 12px',
    display: 'flex', flexDirection: 'column',
    gap: '5px',
    background: '#111827',
    flexShrink: 0,
  },
  mobNoMsg: {
    color: '#6b7280', textAlign: 'center',
    fontSize: '12px', marginTop: '8px'
  },
  mobSystemMsg: {
    color: '#6b7280', textAlign: 'center', fontSize: '11px'
  },
  mobBubble: {
    padding: '6px 10px', borderRadius: '14px',
    maxWidth: '80%', fontSize: '13px',
    lineHeight: 1.4, wordBreak: 'break-word',
  },

  // Input
  mobInputRow: {
    display: 'flex', alignItems: 'center',
    gap: '8px', padding: '8px 12px',
    background: '#1f2937',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  mobInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '22px', padding: '8px 14px',
    color: 'white', fontSize: '14px', outline: 'none',
  },
  mobSendBtn: {
    background: '#7c3aed', color: 'white',
    border: 'none', borderRadius: '50%',
    width: '36px', height: '36px',
    fontSize: '15px', cursor: 'pointer',
  },

  // Bottom Controls
  mobControls: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: '10px',
    padding: '10px 14px',
    background: '#0a0a0f',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    flexShrink: 0,
  },
  mobCtrlBtn: {
    color: 'white', border: 'none',
    borderRadius: '50%', width: '44px', height: '44px',
    fontSize: '18px', cursor: 'pointer',
  },
  mobStartBtn: {
    background: '#7c3aed', color: 'white',
    border: 'none', borderRadius: '24px',
    padding: '11px 28px', fontSize: '15px',
    fontWeight: '800', cursor: 'pointer',
  },
  mobNextBtn: {
    background: '#10b981', color: 'white',
    border: 'none', borderRadius: '24px',
    padding: '11px 28px', fontSize: '15px',
    fontWeight: '800', cursor: 'pointer',
  },
  mobStopBtn: {
    background: '#dc2626', color: 'white',
    border: 'none', borderRadius: '50%',
    width: '44px', height: '44px',
    fontSize: '18px', cursor: 'pointer',
  },

  // ── DESKTOP STYLES ──
  deskContainer: {
    height: '100vh', display: 'flex',
    background: '#fff',
    fontFamily: 'Segoe UI, sans-serif', overflow: 'hidden'
  },
  deskLeft: {
    width: '45%', display: 'flex',
    flexDirection: 'column', background: '#000', flexShrink: 0
  },
  deskVideoBox: {
    flex: 1, position: 'relative',
    overflow: 'hidden',
    borderBottom: '1px solid #1a1a1a'
  },
  deskVideo: {
    width: '100%', height: '100%',
    objectFit: 'cover', display: 'block'
  },
  deskOverlay: {
    position: 'absolute', inset: 0,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center'
  },
  deskOverlayText: {
    color: 'white', fontSize: '20px',
    fontWeight: '700', textAlign: 'center'
  },
  deskSpinner: {
    width: '44px', height: '44px',
    border: '3px solid rgba(255,255,255,0.1)',
    borderTop: '3px solid #a855f7',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 12px'
  },
  deskVideoLabel: {
    position: 'absolute', bottom: '10px', left: '12px',
    background: 'rgba(0,0,0,0.55)', color: '#10b981',
    padding: '4px 12px', borderRadius: '20px',
    fontSize: '12px', fontWeight: '700'
  },
  deskReportBtn: {
    position: 'absolute', bottom: '10px', right: '12px',
    background: 'rgba(0,0,0,0.5)', color: 'white',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '20px', padding: '4px 12px',
    fontSize: '12px', cursor: 'pointer'
  },
  deskVideoControls: {
    position: 'absolute', top: '10px', right: '10px',
    display: 'flex', gap: '6px'
  },
  deskVCtrlBtn: {
    color: 'white', border: 'none',
    borderRadius: '50%', width: '32px', height: '32px',
    fontSize: '14px', cursor: 'pointer'
  },
  deskControlBar: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px', background: '#111', flexShrink: 0
  },
  deskLogo: {
    fontSize: '20px', fontWeight: '900',
    color: 'white', cursor: 'pointer'
  },
  deskOnline: {
    color: '#10b981', fontSize: '13px', fontWeight: '700'
  },
  deskBtnRow: {
    display: 'flex', gap: '8px', alignItems: 'center'
  },
  deskStartBtn: {
    background: '#7c3aed', color: 'white', border: 'none',
    borderRadius: '8px', padding: '8px 22px',
    fontSize: '14px', fontWeight: '700', cursor: 'pointer'
  },
  deskSkipBtn: {
    background: '#374151', color: 'white', border: 'none',
    borderRadius: '8px', padding: '8px 22px',
    fontSize: '14px', fontWeight: '700', cursor: 'pointer'
  },
  deskStopBtn: {
    background: '#dc2626', color: 'white', border: 'none',
    borderRadius: '8px', padding: '8px 16px',
    fontSize: '14px', fontWeight: '700', cursor: 'pointer'
  },
  deskRight: {
    flex: 1, display: 'flex', flexDirection: 'column',
    background: 'white', overflow: 'hidden'
  },
  deskMessages: {
    flex: 1, padding: '16px', overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: '8px'
  },
  deskNoMsg: {
    color: '#9ca3af', textAlign: 'center',
    marginTop: '40px', fontSize: '14px'
  },
  deskSystemMsg: {
    color: '#6b7280', textAlign: 'center',
    fontSize: '13px', padding: '6px 0'
  },
  deskBubble: {
    padding: '10px 14px', borderRadius: '18px',
    maxWidth: '75%', fontSize: '14px',
    lineHeight: 1.5, wordBreak: 'break-word'
  },
  deskInputRow: {
    display: 'flex', gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid #e5e7eb',
    background: 'white', flexShrink: 0
  },
  deskInput: {
    flex: 1, border: '1px solid #e5e7eb',
    borderRadius: '24px', padding: '10px 18px',
    fontSize: '14px', outline: 'none', background: '#f9fafb'
  },
  deskSendBtn: {
    background: '#7c3aed', color: 'white', border: 'none',
    borderRadius: '50%', width: '42px', height: '42px',
    fontSize: '18px', cursor: 'pointer', flexShrink: 0
  },
};

export default ChatPage;