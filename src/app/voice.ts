// Real-time voice call: matchmaking over WebSocket + WebRTC audio peer.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, rtcSocketUrl } from "./api";

export type VoiceState =
  | "idle"
  | "searching"
  | "connecting"
  | "in_call"
  | "ended"
  | "error";

export interface VoicePartner {
  id: number;
  name: string;
}

// Live connection quality, derived from WebRTC getStats (RTT / jitter / loss).
export type ConnQuality = "unknown" | "good" | "poor" | "bad";

// One microphone capture for the whole app session. Telegram's in-app webview
// re-prompts for the mic every time a *fresh* getUserMedia runs, so acquiring a
// new stream per call made the user approve it again and again. We capture the
// stream ONCE and reuse it across every call — permission is asked a single
// time. The stream is kept alive for the page lifetime (the browser releases it
// on unload); calls only attach/detach it from their RTCPeerConnection.
let sharedMic: MediaStream | null = null;

async function acquireMic(): Promise<MediaStream> {
  if (sharedMic && sharedMic.getAudioTracks().some((t) => t.readyState === "live")) {
    return sharedMic;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Bu qurilmada mikrofon ishlamaydi (Telegram'ni yangilang)");
  }
  sharedMic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  return sharedMic;
}

export interface VoiceCall {
  state: VoiceState;
  partner: VoicePartner | null;
  elapsed: number;
  muted: boolean;
  error: string;
  remoteStream: MediaStream | null;
  quality: ConnQuality;
  start: () => void;
  hangup: () => void;
  toggleMute: () => void;
}

export function useVoiceCall(): VoiceCall {
  const [state, setState] = useState<VoiceState>("idle");
  const [partner, setPartner] = useState<VoicePartner | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [quality, setQuality] = useState<ConnQuality>("unknown");

  const ws = useRef<WebSocket | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const iceServers = useRef<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStats = useRef<{ lost: number; recv: number }>({ lost: 0, recv: 0 });
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const preMsgs = useRef<any[]>([]); // signals that arrive before pc is ready

  const send = (msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  };

  const stopTimer = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  };

  const stopHeartbeat = () => {
    if (heartbeat.current) { clearInterval(heartbeat.current); heartbeat.current = null; }
  };

  const stopStats = () => {
    if (statsTimer.current) { clearInterval(statsTimer.current); statsTimer.current = null; }
  };

  // Poll WebRTC stats and derive a coarse quality grade so the UI can warn the
  // user when *their* network is the bottleneck (high RTT / jitter / loss).
  const startStats = (peer: RTCPeerConnection) => {
    stopStats();
    lastStats.current = { lost: 0, recv: 0 };
    statsTimer.current = setInterval(async () => {
      try {
        const stats = await peer.getStats();
        let rtt = 0;
        let jitter = 0;
        let lost = 0;
        let recv = 0;
        stats.forEach((r: any) => {
          if (r.type === "candidate-pair" && r.nominated && r.currentRoundTripTime != null) {
            rtt = r.currentRoundTripTime;
          }
          if (r.type === "inbound-rtp" && r.kind === "audio") {
            jitter = r.jitter ?? 0;
            lost = r.packetsLost ?? 0;
            recv = r.packetsReceived ?? 0;
          }
        });
        const dLost = Math.max(lost - lastStats.current.lost, 0);
        const dRecv = Math.max(recv - lastStats.current.recv, 0);
        lastStats.current = { lost, recv };
        const lossPct = dRecv + dLost > 0 ? dLost / (dRecv + dLost) : 0;

        let q: ConnQuality = "good";
        if (rtt > 0.5 || jitter > 0.05 || lossPct > 0.08) q = "bad";
        else if (rtt > 0.25 || jitter > 0.03 || lossPct > 0.03) q = "poor";
        setQuality(q);
      } catch { /* getStats can throw mid-teardown */ }
    }, 2000);
  };

  const teardownPeer = useCallback(() => {
    stopTimer();
    stopStats();
    setQuality("unknown");
    pc.current?.close();
    pc.current = null;
    // The shared mic stream is deliberately NOT stopped here — keeping it alive
    // is what lets the user grant microphone permission only once per session.
    // (Stopping the senders' tracks would stop the shared mic too.) We only
    // disable capture while idle so the mic indicator isn't hot between calls.
    sharedMic?.getAudioTracks().forEach((t) => (t.enabled = false));
    localStream.current = null;
    setRemoteStream(null);
    pendingIce.current = [];
  }, []);

  const setupPeer = useCallback(async (role: "caller" | "callee") => {
    setState("connecting");
    // Reuses the session's single mic capture (asks for permission only once).
    const stream = await acquireMic();
    // A previous call may have left the track muted — start each call live.
    stream.getAudioTracks().forEach((t) => (t.enabled = true));
    localStream.current = stream;

    const peer = new RTCPeerConnection({ iceServers: iceServers.current });
    pc.current = peer;
    stream.getTracks().forEach((t) => peer.addTrack(t, stream));

    peer.ontrack = (e) => {
      setRemoteStream(e.streams[0]);
      setState("in_call");
      // Keep the receive jitter buffer small so audio stays low-latency on
      // good links (browsers sometimes inflate it). NetEQ still grows it under
      // real loss; this just removes needless baseline delay.
      try {
        for (const r of peer.getReceivers()) {
          if ("jitterBufferTarget" in r) (r as any).jitterBufferTarget = 0;
        }
      } catch { /* not supported on this browser */ }
      if (!timer.current) {
        setElapsed(0);
        timer.current = setInterval(() => setElapsed((x) => x + 1), 1000);
      }
      startStats(peer);
    };
    peer.onicecandidate = (e) => {
      if (e.candidate) send({ type: "ice", candidate: e.candidate });
    };
    peer.onconnectionstatechange = () => {
      const st = peer.connectionState;
      if (st === "connected") setState("in_call");
      if (st === "failed" || st === "disconnected") {
        setError("Aloqa uzildi");
      }
    };

    if (role === "caller") {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      send({ type: "offer", sdp: offer.sdp });
    }
  }, []);

  const handleOffer = useCallback(async (sdp: string) => {
    const peer = pc.current;
    if (!peer) return;
    await peer.setRemoteDescription({ type: "offer", sdp });
    for (const c of pendingIce.current) await peer.addIceCandidate(c).catch(() => {});
    pendingIce.current = [];
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    send({ type: "answer", sdp: answer.sdp });
  }, []);

  const handleAnswer = useCallback(async (sdp: string) => {
    const peer = pc.current;
    if (!peer) return;
    await peer.setRemoteDescription({ type: "answer", sdp });
    for (const c of pendingIce.current) await peer.addIceCandidate(c).catch(() => {});
    pendingIce.current = [];
  }, []);

  const handleIce = useCallback(async (candidate: RTCIceCandidateInit) => {
    const peer = pc.current;
    if (!peer || !peer.remoteDescription) { pendingIce.current.push(candidate); return; }
    await peer.addIceCandidate(candidate).catch(() => {});
  }, []);

  // Apply one signaling message (offer/answer/ice) once pc exists.
  const applySignal = useCallback(async (msg: any) => {
    if (msg.type === "offer") await handleOffer(msg.sdp);
    else if (msg.type === "answer") await handleAnswer(msg.sdp);
    else if (msg.type === "ice" && msg.candidate) await handleIce(msg.candidate);
  }, [handleOffer, handleAnswer, handleIce]);

  const start = useCallback(async () => {
    setError("");
    setPartner(null);
    setState("searching");
    preMsgs.current = [];
    pendingIce.current = [];
    try {
      const cfg = await api.ice();
      if (cfg.iceServers?.length) iceServers.current = cfg.iceServers;
    } catch { /* fall back to default STUN */ }

    const socket = new WebSocket(rtcSocketUrl());
    ws.current = socket;

    socket.onopen = () => {
      send({ type: "ready" });
      // Heartbeat so the server knows we're still here. If the webview is
      // suspended (account switch / backgrounded) these stop and the server
      // drops us from the queue instead of matching a dead "ghost".
      stopHeartbeat();
      heartbeat.current = setInterval(() => send({ type: "ping" }), 10000);
    };
    socket.onmessage = async (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case "matched":
          setPartner(msg.partner);
          try {
            await setupPeer(msg.role);
            // Drain any signals (esp. the caller's offer) that arrived while
            // we were still asking for mic permission / building the peer.
            const queued = preMsgs.current;
            preMsgs.current = [];
            for (const m of queued) await applySignal(m);
          } catch (err: any) {
            const nm = err?.name === "NotAllowedError"
              ? "Mikrofonga ruxsat berilmadi"
              : (err?.message || "Ulanib bo'lmadi");
            setError(nm); setState("error");
          }
          break;
        case "offer":
        case "answer":
        case "ice":
          if (pc.current) await applySignal(msg);
          else preMsgs.current.push(msg); // buffer until peer is ready
          break;
        case "partner_left":
          teardownPeer();
          setState("ended");
          break;
        case "error":
          setError(msg.detail || "Xatolik");
          setState("error");
          break;
      }
    };
    socket.onerror = () => { setError("Ulanish xatosi"); setState("error"); };
    socket.onclose = () => { stopTimer(); stopHeartbeat(); };
  }, [setupPeer, applySignal, teardownPeer]);

  const hangup = useCallback(() => {
    send({ type: "bye" });
    teardownPeer();
    try { ws.current?.close(); } catch { /* noop */ }
    ws.current = null;
    setState("ended");
  }, [teardownPeer]);

  const toggleMute = useCallback(() => {
    const track = localStream.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setMuted(!track.enabled); }
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => {
    try { ws.current?.close(); } catch { /* noop */ }
    teardownPeer();
  }, [teardownPeer]);

  return { state, partner, elapsed, muted, error, remoteStream, quality, start, hangup, toggleMute };
}
