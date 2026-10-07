export class AudioWindow {
  readonly audio = Buffer.alloc(64_000, 255);
  private readonly received = new Uint8Array(64_000);
  covered = 0;
  constructor(readonly start: number) {}
  add(timestamp: number, bytes: Buffer) {
    if (!Number.isFinite(timestamp) || timestamp < 0) return;
    const offset = Math.round((timestamp - this.start) * 8);
    const begin = Math.max(0, offset),
      end = Math.min(64_000, offset + bytes.length);
    for (let i = begin; i < end; i++) {
      if (this.received[i]) continue;
      this.received[i] = 1;
      this.covered++;
      this.audio[i] = bytes[i - offset];
    }
  }
  clear() {
    this.audio.fill(255);
    this.received.fill(0);
    this.covered = 0;
  }
}
