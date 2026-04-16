"use client";
import { useState, useRef, useCallback, useEffect } from "react";

// ─── Musical scales ──────────────────────────────────────────────────────────
const SCALES = {
  major: [0, 2, 4, 7, 9],   // major pentatonic
  minor: [0, 3, 5, 7, 10],  // minor pentatonic
};
const ROOT_MIDI = 57; // A3

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// map word length (1..15) onto 2 octaves of the current pentatonic scale
function quantizeFreq(wordLen, sentiment, minMidi = ROOT_MIDI, maxMidi = ROOT_MIDI + 24) {
  const scale = sentiment >= 0 ? SCALES.major : SCALES.minor;
  const clamped = Math.min(Math.max(wordLen - 1, 0), 15);
  // build a note ladder across the requested range
  const ladder = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    const rel = ((m - ROOT_MIDI) % 12 + 12) % 12;
    if (scale.includes(rel)) ladder.push(m);
  }
  const idx = Math.round((clamped / 15) * (ladder.length - 1));
  return midiToFreq(ladder[idx]);
}

// ─── Audio Engine ────────────────────────────────────────────────────────────

// precomputed brown-noise buffer for ambient bed + whoosh events
function makeBrownNoiseBuffer(ctx, seconds = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

function playTone(audio, wordLen, settings, sentiment, velocity = 1) {
  const { ctx, master, delayIn } = audio;
  if (!ctx || !master) return;
  const freq = quantizeFreq(wordLen, sentiment);
  const now = ctx.currentTime;
  const atk = Math.max(settings.attack, 8) / 1000;
  const dec = settings.decay / 1000;
  const peak = settings.volume * velocity;

  // oscillator + gentle second voice an octave above for body
  const osc = ctx.createOscillator();
  osc.type = settings.waveform;
  osc.frequency.setValueAtTime(freq, now);

  // per-voice lowpass — tames harshness, "mallet" character
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(freq * 6 + 600, 4200);
  lp.Q.value = 0.6;

  // stereo pan — by word length, slight random jitter
  const pan = ctx.createStereoPanner();
  const panVal = ((wordLen - 8) / 14) * 0.7 + (Math.random() - 0.5) * 0.12;
  pan.pan.value = Math.max(-0.85, Math.min(0.85, panVal));

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + atk);
  env.gain.setTargetAtTime(0, now + atk, dec / 3); // exponential-ish tail, smoother than ramp
  env.gain.linearRampToValueAtTime(0, now + atk + dec + 0.15);

  osc.connect(lp);
  lp.connect(pan);
  pan.connect(env);
  env.connect(master);

  if (delayIn) {
    const send = ctx.createGain();
    send.gain.value = 0.28 * velocity;
    env.connect(send);
    send.connect(delayIn);
  }

  osc.start(now);
  osc.stop(now + atk + dec + 0.25);
  return freq;
}

// soft filtered noise burst — sentence punctuation gets a breath
function playWhoosh(audio, noiseBuf, intensity = 1) {
  const { ctx, master, delayIn } = audio;
  if (!ctx || !master || !noiseBuf) return;
  const now = ctx.currentTime;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(1400, now);
  bp.frequency.exponentialRampToValueAtTime(500, now + 0.45);
  bp.Q.value = 0.9;

  const pan = ctx.createStereoPanner();
  pan.pan.value = (Math.random() - 0.5) * 0.6;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.05 * intensity, now + 0.025);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

  src.connect(bp);
  bp.connect(pan);
  pan.connect(env);
  env.connect(master);

  if (delayIn) {
    const send = ctx.createGain();
    send.gain.value = 0.22;
    env.connect(send);
    send.connect(delayIn);
  }

  src.start(now);
  src.stop(now + 0.55);
}

// ─── Sentiment (simple keyword approach) ─────────────────────────────────────
const POS_WORDS = new Set(["beautiful","wonderful","amazing","great","excellent","love","joy","happy","brilliant","fantastic","good","best","perfect","delightful","remarkable","elegant","extraordinary","breathtaking","fascinating"]);
const NEG_WORDS = new Set(["dark","shadow","danger","fear","terrible","awful","bad","wrong","destroy","fail","struggle","problem","difficult","impossible","conflict","war","death","chaos","collapse","broken"]);

function scoreSentiment(words) {
  let score = 0;
  words.forEach(w => {
    const lw = w.toLowerCase();
    if (POS_WORDS.has(lw)) score += 1;
    if (NEG_WORDS.has(lw)) score -= 1;
  });
  return Math.max(-1, Math.min(1, score / Math.max(words.length * 0.15, 1)));
}

// ─── Sample texts ────────────────────────────────────────────────────────────
const SAMPLES = [
  `The quick brown fox jumps over the lazy dog. Extraordinarily, this pangram contains every single letter of the alphabet — a typographical curiosity beloved by designers, cryptographers, and font enthusiasts worldwide.

Photosynthesis is a remarkable biochemical process. Chlorophyll molecules absorb electromagnetic radiation and convert it into adenosine triphosphate. Simultaneously, carbon dioxide and water molecules are transformed into glucose and oxygen through a breathtakingly complex cascade of enzymatic reactions.

Melancholy. Serendipity. Ephemeral. Perseverance. Quintessential. These words carry weight, texture, history. Compare them to: it, a, to, is, be, of, in — small but indispensable, the connective tissue of language.

Jazz musicians improvise spontaneously within harmonic frameworks. A saxophonist might navigate a ii-V-I progression in bebop style, weaving chromatically between chord tones and approach notes at blistering tempos.

She ran. He sat. It rained. Birds sang. Time passed. Leaves fell. Stars appeared. Night deepened. Dreams began. Then — silence.`,

  `Quantum entanglement describes a phenomenon where particles become correlated such that the quantum state of each cannot be described independently. Einstein called this spooky action at a distance.

Architecture balances structure and poetry. Brutalism celebrates raw concrete muscularity. Bauhaus strips everything to function. Deconstructivism deliberately fragments and destabilizes. Each style is a philosophical argument made physical.

Rain patters. Wind howls. Thunder rumbles. Lightning crackles. Hail hammers. Snow whispers. Fog drifts. Dew settles. The weather is always doing something wonderful to language.

Neurons fire. Synapses transmit. Neurotransmitters diffuse across the synaptic cleft. Receptor proteins change conformation. Ion channels open. Membrane potential shifts. A thought occurs.

Supercalifragilisticexpialidocious. Antidisestablishmentarianism. Incomprehensibilities. Floccinaucinihilipilification. These behemoths lumber through sentences like prehistoric creatures, dark and impossible to ignore.`,
];

// ─── Knob ────────────────────────────────────────────────────────────────────
function Knob({ label, value, min, max, step = 1, onChange, fmt }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444" }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#e8c547", cursor: "pointer" }} />
      <span style={{ fontSize: 10, color: "#666", fontFamily: "inherit" }}>{fmt ? fmt(value) : value}</span>
    </div>
  );
}

// ─── Waveform sidebar strip ──────────────────────────────────────────────────
function WaveformSidebar({ densityHistory }) {
  const max = Math.max(...densityHistory, 1);
  return (
    <div style={{
      width: 28, display: "flex", flexDirection: "column-reverse", gap: 1,
      padding: "8px 4px", overflowY: "hidden", alignItems: "center",
    }}>
      {densityHistory.slice(-80).map((d, i) => {
        const pct = d / max;
        return (
          <div key={i} style={{
            width: 16, height: 3, borderRadius: 1, flexShrink: 0,
            background: `rgba(232, 197, 71, ${0.08 + pct * 0.85})`,
          }} />
        );
      })}
    </div>
  );
}

// ─── Animated word span ──────────────────────────────────────────────────────
function WordSpan({ word, isRare, delay }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, []);

  const dur = isRare ? 420 : 180;
  return (
    <span style={{
      display: "inline",
      opacity: visible ? 1 : 0,
      transform: visible ? "none" : "translateY(3px) scale(0.97)",
      transition: `opacity ${dur}ms ease, transform ${dur}ms ease`,
      color: isRare ? "#e8c547" : "inherit",
      textShadow: isRare && visible ? "0 0 18px rgba(232,197,71,0.5)" : "none",
    }}>
      {word}
    </span>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function StreamInstrument() {
  const [phase, setPhase] = useState("unlock"); // unlock | chat
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // meters
  const [activeFreq, setActiveFreq] = useState(null);
  const [wpm, setWpm] = useState(0);
  const [sentimentVal, setSentimentVal] = useState(0);
  const [densityHistory, setDensityHistory] = useState([]);
  const [tokenCount, setTokenCount] = useState(0);

  // settings
  const [settings, setSettings] = useState({
    minFreq: 60, maxFreq: 380, attack: 12, decay: 260,
    volume: 0.11, waveform: "triangle",
    wordAnim: true, sentiment: true, sonic: true, rarityGlow: true,
    pad: true, bed: true, whoosh: true,
  });

  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);
  const delayInRef = useRef(null);
  const padRef = useRef(null); // { oscs, filter, gain, mode }
  const noiseBufRef = useRef(null);
  const bedGainRef = useRef(null);
  const lastToneTimeRef = useRef(0);
  const sentimentRef = useRef(0);
  const wordBufRef = useRef("");
  const streamWordsRef = useRef([]);
  const streamStartRef = useRef(null);
  const messagesEndRef = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  sentimentRef.current = sentimentVal;

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function unlock() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // ── master limiter (catches peaks so fast streams never stab) ──
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(comp);

    // ── delay bus (lowpassed feedback — never gets harsh) ──
    const delayIn = ctx.createGain();
    delayIn.gain.value = 1;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.31;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const delayLp = ctx.createBiquadFilter();
    delayLp.type = "lowpass";
    delayLp.frequency.value = 1800;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.5;

    delayIn.connect(delay);
    delay.connect(delayLp);
    delayLp.connect(feedback);
    feedback.connect(delay);
    delayLp.connect(delayOut);
    delayOut.connect(master);

    // ── ambient brown-noise bed (always-on acoustic floor) ──
    const noiseBuf = makeBrownNoiseBuffer(ctx, 4);
    const bedSrc = ctx.createBufferSource();
    bedSrc.buffer = noiseBuf;
    bedSrc.loop = true;
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = "lowpass";
    bedLp.frequency.value = 520;
    bedLp.Q.value = 0.4;
    const bedHp = ctx.createBiquadFilter();
    bedHp.type = "highpass";
    bedHp.frequency.value = 40;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.0001;
    bedSrc.connect(bedHp);
    bedHp.connect(bedLp);
    bedLp.connect(bedGain);
    bedGain.connect(master);
    bedSrc.start();
    // fade in to idle whisper
    bedGain.gain.linearRampToValueAtTime(0.018, ctx.currentTime + 2.5);

    audioCtxRef.current = ctx;
    gainRef.current = master;
    delayInRef.current = delayIn;
    noiseBufRef.current = noiseBuf;
    bedGainRef.current = bedGain;
    setPhase("chat");
  }

  // ── Pad ──
  function startPad(sentiment) {
    const ctx = audioCtxRef.current;
    const master = gainRef.current;
    if (!ctx || !master || padRef.current) return;

    const mode = sentiment >= 0 ? "major" : "minor";
    const scale = SCALES[mode];
    const rootMidi = ROOT_MIDI - 12; // one octave below tone root
    const rootFreq = midiToFreq(rootMidi);
    const fifthFreq = midiToFreq(rootMidi + 7);
    const thirdFreq = midiToFreq(rootMidi + scale[2]); // mode-defining note

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 1.8);

    const mkOsc = (type, freq, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(filter);
      o.start();
      return o;
    };

    const oscs = [
      mkOsc("sawtooth", rootFreq, -6),
      mkOsc("sawtooth", rootFreq, +6),
      mkOsc("sine",     fifthFreq, 0),
      mkOsc("sine",     thirdFreq, 0),
    ];

    filter.connect(gain);
    gain.connect(master);

    // light send to delay bus
    if (delayInRef.current) {
      const send = ctx.createGain();
      send.gain.value = 0.18;
      gain.connect(send);
      send.connect(delayInRef.current);
    }

    padRef.current = { oscs, filter, gain, mode, rootMidi };
  }

  function stopPad() {
    const ctx = audioCtxRef.current;
    const pad = padRef.current;
    if (!pad || !ctx) return;
    const now = ctx.currentTime;
    pad.gain.gain.cancelScheduledValues(now);
    pad.gain.gain.setValueAtTime(pad.gain.gain.value, now);
    pad.gain.gain.linearRampToValueAtTime(0.0001, now + 1.4);
    pad.oscs.forEach(o => o.stop(now + 1.5));
    padRef.current = null;
  }

  // pad filter cutoff tracks streaming velocity
  useEffect(() => {
    const pad = padRef.current;
    const ctx = audioCtxRef.current;
    if (!pad || !ctx) return;
    const cutoff = 300 + Math.min(wpm / 280, 1) * 2600;
    pad.filter.frequency.cancelScheduledValues(ctx.currentTime);
    pad.filter.frequency.linearRampToValueAtTime(cutoff, ctx.currentTime + 0.25);
  }, [wpm]);

  // sentiment re-tunes pad's mode-defining voice (major <-> minor)
  useEffect(() => {
    const pad = padRef.current;
    const ctx = audioCtxRef.current;
    if (!pad || !ctx) return;
    const nextMode = sentimentVal >= 0 ? "major" : "minor";
    if (nextMode === pad.mode) return;
    const scale = SCALES[nextMode];
    const thirdFreq = midiToFreq(pad.rootMidi + scale[2]);
    const now = ctx.currentTime;
    // oscs[3] is the mode-defining voice
    pad.oscs[3].frequency.cancelScheduledValues(now);
    pad.oscs[3].frequency.linearRampToValueAtTime(thirdFreq, now + 1.2);
    pad.mode = nextMode;
  }, [sentimentVal]);

  const fireWord = useCallback((word) => {
    const s = settingsRef.current;
    const clean = word.replace(/[^a-zA-Z]/g, "");
    if (!clean) return;
    const len = clean.length;

    if (s.sonic) {
      // rate limit — if retriggering within 35ms, attenuate so fast streams don't machine-gun
      const nowMs = performance.now();
      const dt = nowMs - lastToneTimeRef.current;
      let velocity = 1;
      if (dt < 35) velocity = 0.35;
      else if (dt < 70) velocity = 0.7;
      lastToneTimeRef.current = nowMs;

      const freq = playTone(
        { ctx: audioCtxRef.current, master: gainRef.current, delayIn: delayInRef.current },
        len, s, sentimentRef.current, velocity
      );
      if (freq) {
        setActiveFreq(Math.round(freq));
        setTimeout(() => setActiveFreq(null), 180);
      }
    }

    streamWordsRef.current.push(word);
    setDensityHistory(h => [...h, len]);
    setTokenCount(c => c + 1);

    // wpm
    const now = Date.now();
    if (!streamStartRef.current) streamStartRef.current = now;
    const elapsed = (now - streamStartRef.current) / 60000;
    setWpm(Math.round(streamWordsRef.current.length / Math.max(elapsed, 0.001)));

    // sentiment on every 5 words
    if (streamWordsRef.current.length % 5 === 0 && s.sentiment) {
      setSentimentVal(scoreSentiment(streamWordsRef.current.slice(-30)));
    }
  }, []);

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
    setInput("");
    streamWordsRef.current = [];
    streamStartRef.current = null;
    setWpm(0);
    setSentimentVal(0);
    setTokenCount(0);
    setMessages(m => [...m, { role: "user", content: userMsg }, { role: "assistant", words: [], raw: "" }]);
    setStreaming(true);
    wordBufRef.current = "";

    if (settingsRef.current.pad) startPad(sentimentRef.current);

    // swell the ambient bed louder while a stream is active
    const ctx = audioCtxRef.current;
    if (ctx && bedGainRef.current && settingsRef.current.bed) {
      const g = bedGainRef.current.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(0.042, ctx.currentTime + 1.2);
    }

    const text = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
    const chars = text.split("");
    let i = 0;
    let fullText = "";

    await new Promise(resolve => {
      function tick() {
        if (i >= chars.length) {
          if (wordBufRef.current.trim()) { fireWord(wordBufRef.current); wordBufRef.current = ""; }
          resolve();
          return;
        }
        const chunkSize = Math.floor(Math.random() * 4) + 2;
        const chunk = chars.slice(i, i + chunkSize).join("");
        i += chunkSize;
        fullText += chunk;

        for (const char of chunk) {
          if (" \n,.!?—–".includes(char)) {
            if (wordBufRef.current.trim()) fireWord(wordBufRef.current);
            wordBufRef.current = "";
            // sentence enders get a soft breath
            if (".!?\n".includes(char) && settingsRef.current.sonic && settingsRef.current.whoosh) {
              playWhoosh(
                { ctx: audioCtxRef.current, master: gainRef.current, delayIn: delayInRef.current },
                noiseBufRef.current,
                char === "\n" ? 0.7 : 1
              );
            }
          } else {
            wordBufRef.current += char;
          }
        }

        setMessages(m => {
          const updated = [...m];
          updated[updated.length - 1] = { role: "assistant", raw: fullText };
          return updated;
        });

        setTimeout(tick, 22 + Math.random() * 35);
      }
      tick();
    });

    stopPad();
    // drop bed back to idle whisper
    if (ctx && bedGainRef.current) {
      const g = bedGainRef.current.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(0.018, ctx.currentTime + 2.0);
    }
    setStreaming(false);
    setWpm(0);
  }

  // sentiment → background tint
  const sentHue = sentimentVal >= 0
    ? `rgba(40, ${20 + sentimentVal * 30}, 0, ${Math.abs(sentimentVal) * 0.18})`
    : `rgba(0, 0, ${30 + Math.abs(sentimentVal) * 40}, ${Math.abs(sentimentVal) * 0.18})`;

  const setSetting = (k, v) => setSettings(s => ({ ...s, [k]: v }));
  const toggleSetting = (k) => setSettings(s => ({ ...s, [k]: !s[k] }));

  function renderAssistantContent(raw, isStreaming) {
    if (!settings.wordAnim) {
      return (
        <span>
          {raw}
          {isStreaming && <span style={{ display: "inline-block", width: 2, height: 13, background: "#e8c547", marginLeft: 2, verticalAlign: "middle", animation: "blink 0.7s step-end infinite" }} />}
        </span>
      );
    }
    const tokens = raw.split(/(\s+)/);
    let delay = 0;
    return (
      <>
        {tokens.map((tok, i) => {
          if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
          const clean = tok.replace(/[^a-zA-Z]/g, "");
          const isRare = clean.length >= 9;
          const d = delay;
          return <WordSpan key={i} word={tok} isRare={isRare && settings.rarityGlow} delay={d} />;
        })}
        {isStreaming && <span style={{ display: "inline-block", width: 2, height: 13, background: "#e8c547", marginLeft: 2, verticalAlign: "middle", animation: "blink 0.7s step-end infinite" }} />}
      </>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,300;0,400;0,600;1,300&family=Bebas+Neue&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080808; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        input[type=range] { height: 3px; background: #222; border-radius: 2px; outline: none; -webkit-appearance:none; appearance:none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:11px; height:11px; border-radius:50%; background:#e8c547; cursor:pointer; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
      `}</style>

      <div style={{
        minHeight: "100vh", background: "#080808", fontFamily: "'IBM Plex Mono', monospace",
        color: "#c8c0b0", display: "flex", flexDirection: "column", maxWidth: 820, margin: "0 auto",
        position: "relative", overflow: "hidden",
      }}>
        {/* sentiment background layer */}
        <div style={{
          position: "fixed", inset: 0, background: sentHue,
          transition: "background 2s ease", pointerEvents: "none", zIndex: 0,
        }} />

        {phase === "unlock" ? (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", gap: 24, padding: 48, textAlign: "center", position: "relative", zIndex: 1,
          }}>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 52, letterSpacing: "0.06em", color: "#e8c547", lineHeight: 1 }}>STREAM INSTRUMENT</div>
            <div style={{ width: 48, height: 1, background: "#2a2a2a" }} />
            <div style={{ fontSize: 11, color: "#444", lineHeight: 1.8, maxWidth: 380, letterSpacing: "0.04em" }}>
              Every word that arrives from an AI stream carries signal — length, rhythm, rarity, sentiment. This interface makes all of it audible and visible.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 10, color: "#333", letterSpacing: "0.06em" }}>
              <div>◈ SONIC — word length → pentatonic pitch</div>
              <div>◈ PAD — sentiment bends major/minor, wpm opens the filter</div>
              <div>◈ GLOW — rare words illuminate on arrival</div>
              <div>◈ DRIFT — sentiment shifts the background</div>
              <div>◈ WAVEFORM — density fingerprint sidebar</div>
            </div>
            <button onClick={unlock} style={{
              marginTop: 8, background: "#e8c547", border: "none", borderRadius: 4,
              color: "#080808", fontFamily: "'Bebas Neue', sans-serif", fontSize: 18,
              letterSpacing: "0.1em", padding: "12px 36px", cursor: "pointer",
            }}>UNLOCK AUDIO + ENTER</button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", height: "100vh", position: "relative", zIndex: 1 }}>

            {/* ── Header ── */}
            <div style={{
              padding: "14px 20px", borderBottom: "1px solid #141414",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0,
            }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.08em", color: "#e8c547" }}>
                STREAM INSTRUMENT
              </div>

              {/* meters row */}
              <div style={{ display: "flex", gap: 16, alignItems: "center", flex: 1, justifyContent: "center" }}>

                {/* Freq */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 8, letterSpacing: "0.14em", color: "#333", textTransform: "uppercase" }}>freq</span>
                  <span style={{
                    fontSize: 13, color: activeFreq ? "#e8c547" : "#222",
                    transition: "color 0.15s", fontVariantNumeric: "tabular-nums", minWidth: 56, textAlign: "center",
                  }}>{activeFreq ? `${activeFreq}Hz` : "·  ·  ·"}</span>
                </div>

                <div style={{ width: 1, height: 24, background: "#1a1a1a" }} />

                {/* WPM */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 8, letterSpacing: "0.14em", color: "#333", textTransform: "uppercase" }}>w/min</span>
                  <span style={{ fontSize: 13, color: wpm > 0 ? "#e8c547" : "#222", fontVariantNumeric: "tabular-nums", minWidth: 40, textAlign: "center" }}>
                    {wpm > 0 ? wpm : "—"}
                  </span>
                </div>

                <div style={{ width: 1, height: 24, background: "#1a1a1a" }} />

                {/* Tokens */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 8, letterSpacing: "0.14em", color: "#333", textTransform: "uppercase" }}>tokens</span>
                  <span style={{ fontSize: 13, color: tokenCount > 0 ? "#888" : "#222", fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "center" }}>
                    {tokenCount > 0 ? tokenCount : "—"}
                  </span>
                </div>

                <div style={{ width: 1, height: 24, background: "#1a1a1a" }} />

                {/* Sentiment bar */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 8, letterSpacing: "0.14em", color: "#333", textTransform: "uppercase" }}>mood</span>
                  <div style={{ width: 64, height: 6, background: "#111", borderRadius: 3, overflow: "hidden", position: "relative" }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#222" }} />
                    <div style={{
                      position: "absolute", height: "100%", borderRadius: 3,
                      background: sentimentVal >= 0 ? "#7ab648" : "#4488cc",
                      transition: "all 0.8s ease",
                      left: sentimentVal >= 0 ? "50%" : `${50 + sentimentVal * 50}%`,
                      width: `${Math.abs(sentimentVal) * 50}%`,
                    }} />
                  </div>
                </div>
              </div>

              <button onClick={() => setShowSettings(s => !s)} style={{
                background: showSettings ? "#1a1800" : "#111", border: `1px solid ${showSettings ? "#3a3200" : "#1e1e1e"}`,
                color: showSettings ? "#e8c547" : "#555", fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10, padding: "6px 12px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.08em",
              }}>
                {showSettings ? "CLOSE" : "TUNE ▾"}
              </button>
            </div>

            {/* ── Velocity bar ── */}
            <div style={{ height: 2, background: "#0e0e0e", flexShrink: 0 }}>
              <div style={{
                height: "100%", background: "linear-gradient(90deg, #1a1400, #e8c547)",
                width: `${Math.min(wpm / 300 * 100, 100)}%`, transition: "width 0.3s ease",
              }} />
            </div>

            {/* ── Settings panel ── */}
            {showSettings && (
              <div style={{
                background: "#0b0b0b", borderBottom: "1px solid #141414",
                padding: "16px 20px", flexShrink: 0, animation: "fadeUp 0.18s ease",
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px 20px", marginBottom: 14 }}>
                  <Knob label="Min Hz" value={settings.minFreq} min={30} max={200} onChange={v => setSetting("minFreq", v)} fmt={v => `${v}Hz`} />
                  <Knob label="Max Hz" value={settings.maxFreq} min={150} max={800} onChange={v => setSetting("maxFreq", v)} fmt={v => `${v}Hz`} />
                  <Knob label="Decay ms" value={settings.decay} min={20} max={500} onChange={v => setSetting("decay", v)} fmt={v => `${v}ms`} />
                  <Knob label="Volume" value={settings.volume} min={0.01} max={0.5} step={0.01} onChange={v => setSetting("volume", v)} fmt={v => `${Math.round(v*100)}%`} />
                </div>
                <div style={{ display: "flex", gap: 20, alignItems: "flex-end" }}>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 6 }}>waveform</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {["sine","triangle","sawtooth","square"].map(w => (
                        <button key={w} onClick={() => setSetting("waveform", w)} style={{
                          fontSize: 9, fontFamily: "inherit", padding: "4px 10px", borderRadius: 2, cursor: "pointer",
                          border: `1px solid ${settings.waveform === w ? "#3a3000" : "#1e1e1e"}`,
                          background: settings.waveform === w ? "#1a1400" : "#0f0f0f",
                          color: settings.waveform === w ? "#e8c547" : "#444", letterSpacing: "0.06em",
                        }}>{w}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 6 }}>features</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[["sonic","♪ SONIC"],["pad","≈ PAD"],["bed","∿ BED"],["whoosh","~ WHOOSH"],["wordAnim","✦ ANIM"],["rarityGlow","◈ GLOW"],["sentiment","◐ MOOD"]].map(([k, label]) => (
                        <button key={k} onClick={() => toggleSetting(k)} style={{
                          fontSize: 9, fontFamily: "inherit", padding: "4px 10px", borderRadius: 2, cursor: "pointer",
                          border: `1px solid ${settings[k] ? "#3a3000" : "#1e1e1e"}`,
                          background: settings[k] ? "#1a1400" : "#0f0f0f",
                          color: settings[k] ? "#e8c547" : "#444", letterSpacing: "0.06em",
                        }}>{label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Chat + sidebar ── */}
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 20px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
                {messages.length === 0 && (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#222", fontSize: 11, letterSpacing: "0.08em", textAlign: "center", paddingTop: 60 }}>
                    <div style={{ fontSize: 32, marginBottom: 4 }}>◈</div>
                    <div>send a message to begin streaming</div>
                    <div style={{ fontSize: 9, color: "#1a1a1a", marginTop: 4 }}>try asking for a story, explanation, or anything long-form</div>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, alignSelf: msg.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%", animation: "fadeUp 0.2s ease" }}>
                    <span style={{ fontSize: 8, letterSpacing: "0.14em", textTransform: "uppercase", color: msg.role === "user" ? "#3a3000" : "#2a2a2a", alignSelf: msg.role === "user" ? "flex-end" : "flex-start" }}>
                      {msg.role}
                    </span>
                    <div style={{
                      padding: "10px 14px", borderRadius: 6, fontSize: 12.5, lineHeight: 1.72,
                      background: msg.role === "user" ? "#101400" : "#0e0e0e",
                      border: `1px solid ${msg.role === "user" ? "#1e2200" : "#161616"}`,
                      color: msg.role === "user" ? "#b8c880" : "#c0b8a8",
                      whiteSpace: "pre-wrap",
                    }}>
                      {msg.role === "assistant"
                        ? renderAssistantContent(msg.raw || "", streaming && i === messages.length - 1)
                        : msg.content}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Waveform sidebar */}
              <div style={{ width: 36, borderLeft: "1px solid #111", background: "#090909", overflowY: "hidden", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8 }}>
                <span style={{ fontSize: 7, letterSpacing: "0.12em", textTransform: "uppercase", color: "#2a2a2a", writingMode: "vertical-rl", marginBottom: 8 }}>density</span>
                <WaveformSidebar densityHistory={densityHistory} />
              </div>
            </div>

            {/* ── Input ── */}
            <div style={{ padding: "14px 20px 18px", borderTop: "1px solid #111", display: "flex", gap: 10, flexShrink: 0 }}>
              <textarea
                style={{
                  flex: 1, background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 5,
                  color: "#c0b8a8", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                  padding: "10px 13px", outline: "none", resize: "none", lineHeight: 1.55,
                  minHeight: 40, maxHeight: 100,
                }}
                placeholder="send any message to trigger a sample stream…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={1}
              />
              <button onClick={send} disabled={streaming || !input.trim()} style={{
                background: streaming ? "#111" : "#e8c547", border: "none", borderRadius: 5,
                color: streaming ? "#2a2a2a" : "#080808", fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 15, letterSpacing: "0.08em", padding: "10px 20px", cursor: streaming ? "not-allowed" : "pointer",
                transition: "all 0.15s", height: 40,
              }}>
                {streaming ? "···" : "SEND"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
