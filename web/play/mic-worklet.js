/**
 * Capture mono PCM and downsample to 16 kHz with the same box filter as
 * pipeline/mic.ts downsampleBox. Frames are about 100 ms.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.bucket = 0;
    this.count = 0;
    this.pending = [];
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "stop") this.stopped = true;
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;
    let energy = 0;
    for (let i = 0; i < channel.length; i += 1) {
      const sample = channel[i];
      energy += sample * sample;
      this.bucket += sample;
      this.count += 1;
      if (this.count >= this.ratio) {
        const averaged = this.bucket / this.count;
        const clamped = Math.max(-1, Math.min(1, averaged));
        const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
        this.pending.push(int16);
        this.bucket = 0;
        this.count = 0;
        if (this.pending.length >= 1600) {
          const pcm = new Int16Array(this.pending);
          this.pending = [];
          const rms = Math.sqrt(energy / channel.length);
          this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer]);
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
