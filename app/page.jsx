"use client";
import { useState, useRef, useCallback, useEffect } from "react";

// ─── Musical scales ──────────────────────────────────────────────────────────
const SCALES = {
  major: [0, 2, 4, 7, 9],   // major pentatonic
  minor: [0, 3, 5, 7, 10],  // minor pentatonic
};
const ROOT_MIDI = 57; // A3

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function quantizeFreq(wordLen, sentiment, minMidi = ROOT_MIDI, maxMidi = ROOT_MIDI + 24) {
  const scale = sentiment >= 0 ? SCALES.major : SCALES.minor;
  const clamped = Math.min(Math.max(wordLen - 1, 0), 15);
  const ladder = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    const rel = ((m - ROOT_MIDI) % 12 + 12) % 12;
    if (scale.includes(rel)) ladder.push(m);
  }
  const idx = Math.round((clamped / 15) * (ladder.length - 1));
  return midiToFreq(ladder[idx]);
}

// ─── Audio Engine ────────────────────────────────────────────────────────────

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

  const osc = ctx.createOscillator();
  osc.type = settings.waveform;
  osc.frequency.setValueAtTime(freq, now);

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(freq * 6 + 600, 4200);
  lp.Q.value = 0.6;

  const pan = ctx.createStereoPanner();
  const panVal = ((wordLen - 8) / 14) * 0.7 + (Math.random() - 0.5) * 0.12;
  pan.pan.value = Math.max(-0.85, Math.min(0.85, panVal));

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(peak, now + atk);
  env.gain.setTargetAtTime(0, now + atk, dec / 3);
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

// ─── Sentiment ───────────────────────────────────────────────────────────────
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

// ─── Gutenberg helpers ───────────────────────────────────────────────────────
function stripGutenbergBoilerplate(raw) {
  let start = raw.indexOf("*** START OF THE PROJECT GUTENBERG EBOOK");
  if (start === -1) start = raw.indexOf("*** START OF THIS PROJECT GUTENBERG EBOOK");
  if (start !== -1) {
    const nl = raw.indexOf("\n", start);
    raw = raw.slice(nl + 1);
  }
  let end = raw.indexOf("*** END OF THE PROJECT GUTENBERG EBOOK");
  if (end === -1) end = raw.indexOf("*** END OF THIS PROJECT GUTENBERG EBOOK");
  if (end !== -1) raw = raw.slice(0, end);
  return raw.trim();
}

// ─── Sample texts (fallback for chat mode) ───────────────────────────────────
const SAMPLES = [
  `The quick brown fox jumps over the lazy dog. Extraordinarily, this pangram contains every single letter of the alphabet — a typographical curiosity beloved by designers, cryptographers, and font enthusiasts worldwide.

Photosynthesis is a remarkable biochemical process. Chlorophyll molecules absorb electromagnetic radiation and convert it into adenosine triphosphate. Simultaneously, carbon dioxide and water molecules are transformed into glucose and oxygen through a breathtakingly complex cascade of enzymatic reactions.

She ran. He sat. It rained. Birds sang. Time passed. Leaves fell. Stars appeared. Night deepened. Dreams began. Then — silence.`,

  `Quantum entanglement describes a phenomenon where particles become correlated such that the quantum state of each cannot be described independently. Einstein called this spooky action at a distance.

Rain patters. Wind howls. Thunder rumbles. Lightning crackles. Hail hammers. Snow whispers. Fog drifts. Dew settles. The weather is always doing something wonderful to language.

Neurons fire. Synapses transmit. Neurotransmitters diffuse across the synaptic cleft. Receptor proteins change conformation. Ion channels open. Membrane potential shifts. A thought occurs.`,
];

// ─── Sub-components ──────────────────────────────────────────────────────────
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
  const [phase, setPhase] = useState("unlock"); // unlock | app
  const [mode, setMode] = useState("library"); // chat | library
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

  // library
  const [bookQuery, setBookQuery] = useState("");
  const [bookResults, setBookResults] = useState([]);
  const [bookLoading, setBookLoading] = useState(false);
  const [activeBook, setActiveBook] = useState(null); // { title, author, text, wordTokens }
  const [readPosition, setReadPosition] = useState(0); // index into wordTokens
  const [displayedText, setDisplayedText] = useState("");
  const [reading, setReading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [readSpeed, setReadSpeed] = useState(200); // WPM

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
  const padRef = useRef(null);
  const noiseBufRef = useRef(null);
  const bedGainRef = useRef(null);
  const lastToneTimeRef = useRef(0);
  const sentimentRef = useRef(0);
  const wordBufRef = useRef("");
  const streamWordsRef = useRef([]);
  const streamStartRef = useRef(null);
  const messagesEndRef = useRef(null);
  const readerEndRef = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  sentimentRef.current = sentimentVal;

  // reader control refs (so the loop can check without re-render)
  const pausedRef = useRef(false);
  const readingRef = useRef(false);
  const readSpeedRef = useRef(200);
  const readPositionRef = useRef(0);
  pausedRef.current = paused;
  readingRef.current = reading;
  readSpeedRef.current = readSpeed;
  readPositionRef.current = readPosition;

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { readerEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [displayedText]);

  // ── Audio setup ──
  function unlock() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

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
    bedGain.gain.linearRampToValueAtTime(0.018, ctx.currentTime + 2.5);

    audioCtxRef.current = ctx;
    gainRef.current = master;
    delayInRef.current = delayIn;
    noiseBufRef.current = noiseBuf;
    bedGainRef.current = bedGain;
    setPhase("app");
  }

  // ── Pad ──
  function startPad(sentiment) {
    const ctx = audioCtxRef.current;
    const master = gainRef.current;
    if (!ctx || !master || padRef.current) return;

    const m = sentiment >= 0 ? "major" : "minor";
    const scale = SCALES[m];
    const rootMidi = ROOT_MIDI - 12;
    const rootFreq = midiToFreq(rootMidi);
    const fifthFreq = midiToFreq(rootMidi + 7);
    const thirdFreq = midiToFreq(rootMidi + scale[2]);

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
      mkOsc("sine", fifthFreq, 0),
      mkOsc("sine", thirdFreq, 0),
    ];

    filter.connect(gain);
    gain.connect(master);

    if (delayInRef.current) {
      const send = ctx.createGain();
      send.gain.value = 0.18;
      gain.connect(send);
      send.connect(delayInRef.current);
    }

    padRef.current = { oscs, filter, gain, mode: m, rootMidi };
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

  useEffect(() => {
    const pad = padRef.current;
    const ctx = audioCtxRef.current;
    if (!pad || !ctx) return;
    const cutoff = 300 + Math.min(wpm / 280, 1) * 2600;
    pad.filter.frequency.cancelScheduledValues(ctx.currentTime);
    pad.filter.frequency.linearRampToValueAtTime(cutoff, ctx.currentTime + 0.25);
  }, [wpm]);

  useEffect(() => {
    const pad = padRef.current;
    const ctx = audioCtxRef.current;
    if (!pad || !ctx) return;
    const nextMode = sentimentVal >= 0 ? "major" : "minor";
    if (nextMode === pad.mode) return;
    const scale = SCALES[nextMode];
    const thirdFreq = midiToFreq(pad.rootMidi + scale[2]);
    const now = ctx.currentTime;
    pad.oscs[3].frequency.cancelScheduledValues(now);
    pad.oscs[3].frequency.linearRampToValueAtTime(thirdFreq, now + 1.2);
    pad.mode = nextMode;
  }, [sentimentVal]);

  // bed swell
  function swellBed() {
    const ctx = audioCtxRef.current;
    if (ctx && bedGainRef.current && settingsRef.current.bed) {
      const g = bedGainRef.current.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(0.042, ctx.currentTime + 1.2);
    }
  }
  function unswellBed() {
    const ctx = audioCtxRef.current;
    if (ctx && bedGainRef.current) {
      const g = bedGainRef.current.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(0.018, ctx.currentTime + 2.0);
    }
  }

  const getAudio = () => ({ ctx: audioCtxRef.current, master: gainRef.current, delayIn: delayInRef.current });

  // ── fireWord (shared by chat + reader) ──
  const fireWord = useCallback((word) => {
    const s = settingsRef.current;
    const clean = word.replace(/[^a-zA-Z]/g, "");
    if (!clean) return;
    const len = clean.length;

    if (s.sonic) {
      const nowMs = performance.now();
      const dt = nowMs - lastToneTimeRef.current;
      let velocity = 1;
      if (dt < 35) velocity = 0.35;
      else if (dt < 70) velocity = 0.7;
      lastToneTimeRef.current = nowMs;

      const freq = playTone(getAudio(), len, s, sentimentRef.current, velocity);
      if (freq) {
        setActiveFreq(Math.round(freq));
        setTimeout(() => setActiveFreq(null), 180);
      }
    }

    streamWordsRef.current.push(word);
    setDensityHistory(h => [...h, len]);
    setTokenCount(c => c + 1);

    const now = Date.now();
    if (!streamStartRef.current) streamStartRef.current = now;
    const elapsed = (now - streamStartRef.current) / 60000;
    setWpm(Math.round(streamWordsRef.current.length / Math.max(elapsed, 0.001)));

    if (streamWordsRef.current.length % 5 === 0 && s.sentiment) {
      setSentimentVal(scoreSentiment(streamWordsRef.current.slice(-30)));
    }
  }, []);

  const fireWhsp = useCallback((char) => {
    if (".!?\n".includes(char) && settingsRef.current.sonic && settingsRef.current.whoosh) {
      playWhoosh(getAudio(), noiseBufRef.current, char === "\n" ? 0.7 : 1);
    }
  }, []);

  // ── Chat send (sample text) ──
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
    swellBed();

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
          if (" \n,.!?;:—–".includes(char)) {
            if (wordBufRef.current.trim()) fireWord(wordBufRef.current);
            wordBufRef.current = "";
            fireWhsp(char);
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
    unswellBed();
    setStreaming(false);
    setWpm(0);
  }

  // ── Gutenberg search ──
  async function searchBooks() {
    if (!bookQuery.trim()) return;
    setBookLoading(true);
    setBookResults([]);
    try {
      const res = await fetch(`https://gutendex.com/books/?search=${encodeURIComponent(bookQuery.trim())}&languages=en`);
      const data = await res.json();
      setBookResults(
        (data.results || []).slice(0, 15).map(b => ({
          id: b.id,
          title: b.title,
          author: b.authors?.[0]?.name || "Unknown",
        }))
      );
    } catch (e) {
      console.error("Search failed:", e);
    }
    setBookLoading(false);
  }

  async function loadBook(book) {
    setBookLoading(true);
    try {
      const res = await fetch(`/api/gutenberg?id=${book.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      const cleaned = stripGutenbergBoilerplate(raw);
      const wordTokens = cleaned.split(/(\s+)/);
      setActiveBook({ title: book.title, author: book.author, text: cleaned, wordTokens });
      setReadPosition(0);
      setDisplayedText("");
    } catch (e) {
      console.error("Failed to load book:", e);
    }
    setBookLoading(false);
  }

  // ── Book reader loop ──
  async function startReading() {
    if (!activeBook || reading) return;
    setReading(true);
    readingRef.current = true;
    streamWordsRef.current = [];
    streamStartRef.current = null;
    setWpm(0);
    setSentimentVal(0);
    setTokenCount(0);

    if (settingsRef.current.pad) startPad(sentimentRef.current);
    swellBed();

    const { wordTokens } = activeBook;
    let pos = readPositionRef.current;
    let builtText = wordTokens.slice(0, pos).join("");

    while (pos < wordTokens.length && readingRef.current) {
      // pause loop
      while (pausedRef.current && readingRef.current) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!readingRef.current) break;

      const token = wordTokens[pos];
      builtText += token;
      pos++;

      const isWhitespace = /^\s+$/.test(token);
      if (!isWhitespace) {
        fireWord(token);
        // check for sentence endings within the token
        const lastChar = token.slice(-1);
        fireWhsp(lastChar);
      } else if (token.includes("\n")) {
        fireWhsp("\n");
      }

      setReadPosition(pos);
      readPositionRef.current = pos;
      setDisplayedText(builtText);

      // delay based on current speed — only wait after real words
      if (!isWhitespace) {
        const msPerWord = 60000 / readSpeedRef.current;
        // add slight natural variance (+-15%)
        const jitter = msPerWord * (0.85 + Math.random() * 0.3);
        await new Promise(r => setTimeout(r, jitter));
      }
    }

    stopPad();
    unswellBed();
    setReading(false);
    readingRef.current = false;
    setWpm(0);
  }

  function stopReading() {
    readingRef.current = false;
    setReading(false);
    setPaused(false);
  }

  function togglePause() {
    setPaused(p => !p);
  }

  // ── Render helpers ──
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
    return (
      <>
        {tokens.map((tok, i) => {
          if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
          const clean = tok.replace(/[^a-zA-Z]/g, "");
          const isRare = clean.length >= 9;
          return <WordSpan key={i} word={tok} isRare={isRare && settings.rarityGlow} delay={0} />;
        })}
        {isStreaming && <span style={{ display: "inline-block", width: 2, height: 13, background: "#e8c547", marginLeft: 2, verticalAlign: "middle", animation: "blink 0.7s step-end infinite" }} />}
      </>
    );
  }

  const progress = activeBook ? Math.round((readPosition / activeBook.wordTokens.length) * 100) : 0;

  // ── Tab button helper ──
  const tabStyle = (active) => ({
    fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", padding: "5px 14px",
    borderRadius: 3, cursor: "pointer", letterSpacing: "0.08em", border: "none",
    background: active ? "#1a1400" : "transparent",
    color: active ? "#e8c547" : "#444",
  });

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
              Every word carries signal — length, rhythm, rarity, sentiment. Read books from Project Gutenberg through a sonic interface that makes text audible and visible.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 10, color: "#333", letterSpacing: "0.06em" }}>
              <div>◈ LIBRARY — search + stream any Gutenberg book</div>
              <div>◈ SONIC — word length → pentatonic pitch</div>
              <div>◈ PAD — sentiment bends major/minor, speed opens the filter</div>
              <div>◈ SPEED — control your reading pace in real time</div>
              <div>◈ GLOW — rare words illuminate on arrival</div>
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
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.08em", color: "#e8c547" }}>
                  STREAM INSTRUMENT
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  <button onClick={() => !streaming && !reading && setMode("library")} title="Search and read books from Project Gutenberg" style={tabStyle(mode === "library")}>LIBRARY</button>
                  <button onClick={() => !streaming && !reading && setMode("chat")} title="Demo mode — type anything to hear a sample text stream" style={tabStyle(mode === "chat")}>CHAT</button>
                </div>
              </div>

              {/* meters */}
              <div style={{ display: "flex", gap: 16, alignItems: "center", flex: 1, justifyContent: "center" }}>
                <div title="Current note frequency — each word's length picks a pitch on a pentatonic scale" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "help" }}>
                  <span style={{ fontSize: 8, letterSpacing: "0.14em", color: "#333", textTransform: "uppercase" }}>freq</span>
                  <span style={{
                    fontSize: 13, color: activeFreq ? "#e8c547" : "#222",
                    transition: "color 0.15s", fontVariantNumeric: "tabular-nums", minWidth: 56, textAlign: "center",
                  }}>{activeFreq ? `${activeFreq}Hz` : "·  ·  ·"}</span>
                </div>
                <div style={{ width: 1, height: 24, background: "#1a1a1a" }} />
                <div title="Words per minute — how fast text is arriving right now" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "help" }}>
                  <span style={{ fontSize: 8, letterSpacing: "0.14em", color: "#333", textTransform: "uppercase" }}>w/min</span>
                  <span style={{ fontSize: 13, color: wpm > 0 ? "#e8c547" : "#222", fontVariantNumeric: "tabular-nums", minWidth: 40, textAlign: "center" }}>
                    {wpm > 0 ? wpm : "—"}
                  </span>
                </div>
                <div style={{ width: 1, height: 24, background: "#1a1a1a" }} />
                <div title="Total words streamed in this session" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "help" }}>
                  <span style={{ fontSize: 8, letterSpacing: "0.14em", color: "#333", textTransform: "uppercase" }}>tokens</span>
                  <span style={{ fontSize: 13, color: tokenCount > 0 ? "#888" : "#222", fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "center" }}>
                    {tokenCount > 0 ? tokenCount : "—"}
                  </span>
                </div>
                <div style={{ width: 1, height: 24, background: "#1a1a1a" }} />
                <div title="Sentiment — tracks positive vs negative words. Green = positive, blue = negative. Shifts background color and bends the pad between major and minor key." style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "help" }}>
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

              <button onClick={() => setShowSettings(s => !s)} title="Open the sound design panel — works during playback" style={{
                background: showSettings ? "#1a1800" : (reading || streaming) ? "#1a1200" : "#111",
                border: `1px solid ${showSettings ? "#3a3200" : (reading || streaming) ? "#2a2000" : "#1e1e1e"}`,
                color: showSettings ? "#e8c547" : "#555", fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10, padding: "6px 12px", borderRadius: 3, cursor: "pointer", letterSpacing: "0.08em",
                transition: "all 0.3s",
              }}>
                {showSettings ? "CLOSE" : "TUNE ▾"}
              </button>
            </div>

            {/* ── Velocity bar ── */}
            <div title="Streaming velocity — grows with words per minute" style={{ height: 2, background: "#0e0e0e", flexShrink: 0 }}>
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
                {(reading || streaming) && (
                  <div style={{ fontSize: 9, color: "#3a3000", letterSpacing: "0.06em", marginBottom: 12, lineHeight: 1.6 }}>
                    changes take effect immediately — adjust while listening
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px 20px", marginBottom: 6 }}>
                  <Knob label="Min Hz" value={settings.minFreq} min={30} max={200} onChange={v => setSetting("minFreq", v)} fmt={v => `${v}Hz`} />
                  <Knob label="Max Hz" value={settings.maxFreq} min={150} max={800} onChange={v => setSetting("maxFreq", v)} fmt={v => `${v}Hz`} />
                  <Knob label="Decay ms" value={settings.decay} min={20} max={500} onChange={v => setSetting("decay", v)} fmt={v => `${v}ms`} />
                  <Knob label="Volume" value={settings.volume} min={0.01} max={0.5} step={0.01} onChange={v => setSetting("volume", v)} fmt={v => `${Math.round(v*100)}%`} />
                </div>
                <div style={{ fontSize: 8, color: "#2a2a2a", letterSpacing: "0.04em", marginBottom: 14, lineHeight: 1.6 }}>
                  controls the per-word tones. min/max Hz set the pitch range. decay is how long each note rings. volume is the overall tone loudness.
                </div>
                <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 6 }}>waveform</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[
                        ["sine", "smooth, pure tone"],
                        ["triangle", "warm, soft buzz"],
                        ["sawtooth", "bright, buzzy edge"],
                        ["square", "hollow, retro beep"],
                      ].map(([w, desc]) => (
                        <button key={w} onClick={() => setSetting("waveform", w)} title={desc} style={{
                          fontSize: 9, fontFamily: "inherit", padding: "4px 10px", borderRadius: 2, cursor: "pointer",
                          border: `1px solid ${settings.waveform === w ? "#3a3000" : "#1e1e1e"}`,
                          background: settings.waveform === w ? "#1a1400" : "#0f0f0f",
                          color: settings.waveform === w ? "#e8c547" : "#444", letterSpacing: "0.06em",
                        }}>{w}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 8, color: "#2a2a2a", marginTop: 6, letterSpacing: "0.04em" }}>
                      shape of the oscillator wave — changes the timbre of each word tone
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444", marginBottom: 6 }}>features</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {[
                        ["sonic",     "♪ SONIC",   "Per-word tones — each word plays a note based on its length"],
                        ["pad",       "≈ PAD",     "Background drone that shifts between major and minor key with sentiment"],
                        ["bed",       "∿ BED",     "Low brown-noise ambient floor — soft hiss that makes tones feel grounded"],
                        ["whoosh",    "~ WHOOSH",  "Soft noise breath on sentence endings (periods, question marks)"],
                        ["wordAnim",  "✦ ANIM",   "Fade-in animation on each word as it appears"],
                        ["rarityGlow","◈ GLOW",    "Long/rare words (9+ letters) glow gold when they arrive"],
                        ["sentiment", "◐ MOOD",    "Track positive vs negative words — shifts background color and pad key"],
                      ].map(([k, label, desc]) => (
                        <button key={k} onClick={() => toggleSetting(k)} title={desc} style={{
                          fontSize: 9, fontFamily: "inherit", padding: "4px 10px", borderRadius: 2, cursor: "pointer",
                          border: `1px solid ${settings[k] ? "#3a3000" : "#1e1e1e"}`,
                          background: settings[k] ? "#1a1400" : "#0f0f0f",
                          color: settings[k] ? "#e8c547" : "#444", letterSpacing: "0.06em",
                        }}>{label}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 8, color: "#2a2a2a", marginTop: 6, letterSpacing: "0.04em" }}>
                      toggle each layer on/off — hover for details
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Content + sidebar ── */}
            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
              <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

                {/* ════════════ LIBRARY MODE ════════════ */}
                {mode === "library" && !activeBook && (
                  <>
                    {/* search bar */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input
                        style={{
                          flex: 1, background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 5,
                          color: "#c0b8a8", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                          padding: "10px 13px", outline: "none",
                        }}
                        placeholder="search Project Gutenberg…"
                        value={bookQuery}
                        onChange={e => setBookQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") searchBooks(); }}
                      />
                      <button onClick={searchBooks} disabled={bookLoading} style={{
                        background: "#e8c547", border: "none", borderRadius: 5,
                        color: "#080808", fontFamily: "'Bebas Neue', sans-serif",
                        fontSize: 15, letterSpacing: "0.08em", padding: "10px 20px", cursor: "pointer",
                        opacity: bookLoading ? 0.5 : 1,
                      }}>SEARCH</button>
                    </div>

                    {bookLoading && (
                      <div style={{ color: "#333", fontSize: 11, letterSpacing: "0.06em", textAlign: "center", padding: 20 }}>searching…</div>
                    )}

                    {bookResults.length === 0 && !bookLoading && (
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#222", fontSize: 11, letterSpacing: "0.08em", textAlign: "center", paddingTop: 60 }}>
                        <div style={{ fontSize: 32, marginBottom: 4 }}>◈</div>
                        <div>search for a book to begin reading</div>
                        <div style={{ fontSize: 9, color: "#1a1a1a", marginTop: 4 }}>try "frankenstein", "pride and prejudice", "moby dick"</div>
                      </div>
                    )}

                    {bookResults.map((book) => (
                      <button key={book.id} onClick={() => loadBook(book)} style={{
                        display: "flex", flexDirection: "column", gap: 4, padding: "14px 16px",
                        background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 6,
                        textAlign: "left", cursor: "pointer", animation: "fadeUp 0.2s ease",
                        width: "100%",
                      }}>
                        <span style={{ fontSize: 12.5, color: "#c0b8a8", lineHeight: 1.4 }}>{book.title}</span>
                        <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.04em" }}>{book.author}</span>
                      </button>
                    ))}
                  </>
                )}

                {/* ════════════ LIBRARY — READER ════════════ */}
                {mode === "library" && activeBook && (
                  <>
                    {/* book header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, color: "#c0b8a8", lineHeight: 1.4, marginBottom: 2 }}>{activeBook.title}</div>
                        <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.04em" }}>{activeBook.author}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "#333", fontVariantNumeric: "tabular-nums" }}>{progress}%</span>
                        <button onClick={() => { stopReading(); setActiveBook(null); setDisplayedText(""); setReadPosition(0); }} style={{
                          fontSize: 9, fontFamily: "inherit", padding: "4px 10px", borderRadius: 2, cursor: "pointer",
                          border: "1px solid #1e1e1e", background: "#0f0f0f", color: "#444", letterSpacing: "0.06em",
                        }}>CLOSE</button>
                      </div>
                    </div>

                    {/* progress bar */}
                    <div style={{ height: 2, background: "#111", borderRadius: 1, marginBottom: 12, flexShrink: 0 }}>
                      <div style={{ height: "100%", background: "#e8c547", borderRadius: 1, width: `${progress}%`, transition: "width 0.3s" }} />
                    </div>

                    {/* reading pane */}
                    <div style={{
                      flex: 1, fontSize: 13.5, lineHeight: 1.85, color: "#c0b8a8",
                      whiteSpace: "pre-wrap", letterSpacing: "0.01em",
                    }}>
                      {settings.wordAnim ? (
                        <>
                          {displayedText.split(/(\s+)/).map((tok, i) => {
                            if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
                            const clean = tok.replace(/[^a-zA-Z]/g, "");
                            const isRare = clean.length >= 9;
                            return <WordSpan key={i} word={tok} isRare={isRare && settings.rarityGlow} delay={0} />;
                          })}
                        </>
                      ) : displayedText}
                      {reading && <span style={{ display: "inline-block", width: 2, height: 14, background: "#e8c547", marginLeft: 2, verticalAlign: "middle", animation: "blink 0.7s step-end infinite" }} />}
                      <div ref={readerEndRef} />
                    </div>
                  </>
                )}

                {/* ════════════ CHAT MODE ════════════ */}
                {mode === "chat" && (
                  <>
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
                  </>
                )}
              </div>

              {/* Waveform sidebar */}
              <div style={{ width: 36, borderLeft: "1px solid #111", background: "#090909", overflowY: "hidden", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8 }}>
                <span style={{ fontSize: 7, letterSpacing: "0.12em", textTransform: "uppercase", color: "#2a2a2a", writingMode: "vertical-rl", marginBottom: 8 }}>density</span>
                <WaveformSidebar densityHistory={densityHistory} />
              </div>
            </div>

            {/* ── Footer ── */}
            <div style={{ padding: "14px 20px 18px", borderTop: "1px solid #111", flexShrink: 0 }}>

              {/* ── Library footer: speed control + play/pause/stop ── */}
              {mode === "library" && activeBook && (
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  {/* transport buttons */}
                  {!reading ? (
                    <button onClick={startReading} title={readPosition > 0 ? "Continue reading from where you left off" : "Start streaming the book word-by-word with sound"} style={{
                      background: "#e8c547", border: "none", borderRadius: 5,
                      color: "#080808", fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 15, letterSpacing: "0.08em", padding: "10px 20px", cursor: "pointer", height: 40,
                    }}>{readPosition > 0 ? "RESUME" : "READ"}</button>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={togglePause} title={paused ? "Continue reading" : "Freeze in place — sound sustains, pick up where you left off"} style={{
                        background: paused ? "#e8c547" : "#1a1400", border: `1px solid ${paused ? "#e8c547" : "#3a3000"}`,
                        borderRadius: 5, color: paused ? "#080808" : "#e8c547", fontFamily: "'Bebas Neue', sans-serif",
                        fontSize: 15, letterSpacing: "0.08em", padding: "10px 16px", cursor: "pointer", height: 40,
                      }}>{paused ? "RESUME" : "PAUSE"}</button>
                      <button onClick={stopReading} title="Stop reading — you can resume from this position later" style={{
                        background: "#111", border: "1px solid #1e1e1e", borderRadius: 5,
                        color: "#555", fontFamily: "'Bebas Neue', sans-serif",
                        fontSize: 15, letterSpacing: "0.08em", padding: "10px 16px", cursor: "pointer", height: 40,
                      }}>STOP</button>
                    </div>
                  )}

                  {/* speed slider */}
                  <div title="Drag to change how fast words appear — affects the sound too (faster = brighter pad filter)" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#444" }}>reading speed</span>
                      <span style={{ fontSize: 10, color: "#666", fontVariantNumeric: "tabular-nums" }}>{readSpeed} w/min</span>
                    </div>
                    <input type="range" min={40} max={600} step={10} value={readSpeed}
                      onChange={e => setReadSpeed(Number(e.target.value))}
                      style={{ width: "100%", accentColor: "#e8c547", cursor: "pointer" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#333", letterSpacing: "0.06em" }}>
                      <span>40 — meditative</span>
                      <span>600 — speed-read</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Library footer: no book selected — just context ── */}
              {mode === "library" && !activeBook && (
                <div style={{ fontSize: 10, color: "#222", letterSpacing: "0.06em", textAlign: "center" }}>
                  select a book above to begin the sonic reading experience
                </div>
              )}

              {/* ── Chat footer ── */}
              {mode === "chat" && (
                <div style={{ display: "flex", gap: 10 }}>
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
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
