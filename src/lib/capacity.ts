export function positiveLimit(name: string, fallback: number, maximum = 1000) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  return value;
}

// One voice process multiplexes independent calls; the database arbitrates admission.
export const callCapacity = () => positiveLimit("RING_MAX_ACTIVE_CALLS", 100);

/** FIFO admission for provider requests, including response-body consumption. */
export class RequestGate {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private limit: number,
    private maxWaiting: number,
  ) {}

  async run<T>(work: () => Promise<T>, waitMs = 60_000): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiting.length >= this.maxWaiting)
        throw new Error("Speech service is busy. Please try again shortly.");
      await new Promise<void>((resolve, reject) => {
        const admit = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          this.waiting = this.waiting.filter((item) => item !== admit);
          reject(new Error("Speech service queue timed out."));
        }, waitMs);
        this.waiting.push(admit);
      });
    } else this.active++;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next)
        next(); // Transfer the occupied slot without letting newcomers jump the queue.
      else this.active--;
    }
  }
}
