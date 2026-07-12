/**
 * One-shot voice→text capture for chat composers. Records from the mic until
 * stop() is called, POSTs the audio to the local STT service, and resolves with
 * the transcript — so a mic button can populate a prompt box (voice-to-prompt).
 *
 * Unlike useVoice (which routes transcripts to the skill router), this just hands
 * back the recognized text. The onLevel callback feeds a live mic meter.
 */

const STT_URL = 'http://localhost:8000/api/v1/transcribe';

export function createRecorder({ onLevel } = {}) {
  let rec, stream, ctx, raf;
  const chunks = [];
  let resolveText;

  const done = new Promise((res) => (resolveText = res));

  function cleanup() {
    cancelAnimationFrame(raf);
    onLevel?.(0);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
  }

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const v of data) sum += v;
      onLevel?.(sum / data.length / 255);
      raf = requestAnimationFrame(tick);
    };
    tick();

    rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      cleanup();
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (!blob.size) return resolveText('');
      try {
        const fd = new FormData();
        fd.append('file', blob, 'speech.webm');
        const r = await fetch(STT_URL, { method: 'POST', body: fd });
        const j = await r.json();
        resolveText((j.transcript || '').trim());
      } catch {
        resolveText('');
      }
    };
    rec.start();
  }

  function stop() {
    if (rec && rec.state !== 'inactive') rec.stop();
    else resolveText('');
  }

  return { start, stop, done };
}
