import type { PublicState } from "@/lib/types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./ui/card";
import { Icon } from "./ui/icon";

type Props = {
  state: PublicState;
  now: number;
  cooldown: number;
  countdown: string;
  busy: boolean;
  error: string;
  onConnect: () => void;
  onCompose: () => void;
  onCode: () => void;
  onCancel: () => void;
};

export function CallLobby({
  state,
  now,
  cooldown,
  countdown,
  busy,
  error,
  onConnect,
  onCompose,
  onCode,
  onCancel,
}: Props) {
  const playing = state.lastGame?.status === "playing";
  const codeValid =
    !!state.queue?.code &&
    !!state.queue.expiresAt &&
    state.queue.expiresAt > now;
  const ready =
    state.live &&
    !!state.phone &&
    !!state.session?.eligible &&
    codeValid &&
    cooldown === 0 &&
    !playing;
  const target = playing ? state.lastGame!.target : state.required;
  const status = playing
    ? "Call in progress"
    : !state.live
      ? "Opens at launch"
      : cooldown > 0
        ? "Between attempts"
        : ready
          ? "Ready to dial"
          : "Before you dial";
  const game = state.lastGame;
  const result = !game
    ? null
    : playing
      ? `${game.correct} of ${game.target} correct. Keep going on the phone.`
      : game.execution === "applied"
        ? "You won. Your token change is confirmed."
        : game.execution === "holding_required"
          ? "You won. Hold Ring in your connected wallet to apply your change."
          : game.status === "won"
            ? "You won. Your change is waiting for chain confirmation."
            : game.status === "void"
              ? "The call had a technical problem. Your attempt was restored."
              : "Your last run ended. You can try again after the cooldown.";
  const steps = [
    {
      icon: "wallet" as const,
      title: "Connect your wallet",
      detail: state.session
        ? `${state.session.wallet.slice(0, 4)}…${state.session.wallet.slice(-4)} connected`
        : "Your identity for this attempt",
      done: !!state.session,
    },
    {
      icon: "check" as const,
      title: "Hold any amount of Ring",
      detail: !state.mint
        ? "Token address announced at launch"
        : state.session?.eligible
          ? "Holding requirement met"
          : "Your balance is checked before the call",
      done: !!state.session?.eligible,
    },
    {
      icon: "document" as const,
      title: "Choose your change",
      detail: state.queue
        ? "Your proposal is locked for this call"
        : "Post a proposal to get your private code",
      done: !!state.queue,
    },
  ];

  return (
    <div className="call-lobby">
      <header className="lobby-heading">
        <h2 id="panel-title">
          Your next move.
          <br />
          <span>On the line.</span>
        </h2>
        <p>One call. A streak of right answers. Your change to Ring.</p>
      </header>
      <div className="lobby-grid">
        <Card className="hotline-card">
          <CardHeader>
            <div className="line-status">
              <span
                className={
                  ready || playing ? "status-light active" : "status-light"
                }
              />
              {status}
            </div>
            <CardTitle>
              <h3>The Ring hotline</h3>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="receiver-emblem">
              <Icon name="phone" />
            </div>
            {state.phone ? (
              <div className="lobby-number hotline-number">{state.phone}</div>
            ) : (
              <div className="lobby-number">Number coming soon</div>
            )}
            <p>
              {playing
                ? "Stay on your phone. Your progress appears here."
                : state.live
                  ? "Call from your phone, then enter your four-digit code on the keypad."
                  : "The number is set. The game opens when Ring launches."}
            </p>
            <dl className="lobby-rules">
              <div>
                <dt>In a row</dt>
                <dd>
                  {target}
                  <small> correct</small>
                </dd>
              </div>
              <div>
                <dt>Per answer</dt>
                <dd>
                  8<small> seconds</small>
                </dd>
              </div>
            </dl>
          </CardContent>
          <CardFooter>
            <span>
              Say A, B, C or D. Or press 1, 2, 3 or 4.
              <br />
              Your question target locks when the game starts.
            </span>
          </CardFooter>
        </Card>
        <div className="lobby-preparation">
          <Card className="readiness-card">
            <CardHeader>
              <CardTitle>
                <h3>Make it your call.</h3>
              </CardTitle>
              <CardDescription>Three things to have ready.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="readiness-list">
                {steps.map((step) => (
                  <li key={step.title} data-complete={step.done}>
                    <span className="readiness-icon">
                      <Icon name={step.done ? "check" : step.icon} />
                    </span>
                    <div>
                      <strong>{step.title}</strong>
                      <span>{step.detail}</span>
                    </div>
                    {step.done && <span className="sr-only">Complete</span>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card className="ticket-card">
            <CardHeader>
              <CardTitle>
                <h3>
                  <Icon name="lock" /> Your private call code
                </h3>
              </CardTitle>
              <CardDescription>
                {playing
                  ? "Your code has been used for this call."
                  : codeValid
                    ? "Enter these digits when the hotline answers."
                    : state.queue
                      ? "Generate a fresh code before you dial."
                      : "Lock a proposal to receive your four digits."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="ticket-digits"
                aria-label={
                  codeValid && !playing
                    ? `Private code: ${state.queue!.code!.split("").join(" ")}`
                    : "No active call code"
                }
              >
                {(codeValid && !playing
                  ? state.queue!.code!.split("")
                  : Array.from({ length: 4 }, () => "")
                ).map((digit, index) => (
                  <span key={index} aria-hidden="true">
                    {digit || <span className="empty-digit" />}
                  </span>
                ))}
              </div>
              <p className="ticket-note">
                {codeValid && !playing
                  ? `Expires ${new Date(state.queue!.expiresAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Keep it to yourself.`
                  : "Private to your wallet. Never posted on the board."}
              </p>
            </CardContent>
            {state.queue && !playing && (
              <CardFooter className="ticket-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || cooldown > 0}
                  onClick={onCode}
                >
                  {busy ? "Updating…" : "Get a new code"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={onCancel}
                >
                  Leave queue
                </button>
              </CardFooter>
            )}
          </Card>
        </div>
      </div>
      {result && (
        <p className="lobby-result" role="status">
          {result}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer className="lobby-footer">
        <div>
          <strong>
            {cooldown > 0 && !playing
              ? `Next attempt in ${countdown}`
              : "One attempt every 10 minutes."}
          </strong>
          <p>
            {state.calls && state.live
              ? `${state.calls.active} of ${state.calls.capacity} call slots in use.`
              : "New questions for every caller."}
          </p>
        </div>
        {ready ? (
          <a className="primary-button lobby-cta" href={`tel:${state.phone}`}>
            <Icon name="phone" /> Call Ring <Icon name="arrow" />
          </a>
        ) : playing ? (
          <button className="primary-button lobby-cta" disabled>
            Call in progress
          </button>
        ) : !state.session ? (
          <button className="primary-button lobby-cta" onClick={onConnect}>
            Connect your wallet <Icon name="arrow" />
          </button>
        ) : cooldown > 0 ? (
          <button className="primary-button lobby-cta" disabled>
            Waiting for next attempt
          </button>
        ) : state.queue && state.live ? (
          <button
            className="primary-button lobby-cta"
            disabled={busy || !state.session.eligible}
            onClick={onCode}
          >
            {!state.session.eligible
              ? "Ring balance required"
              : busy
                ? "Getting your code…"
                : "Get your call code"}
            <Icon name="arrow" />
          </button>
        ) : (
          <button className="primary-button lobby-cta" onClick={onCompose}>
            Prepare your proposal <Icon name="arrow" />
          </button>
        )}
      </footer>
    </div>
  );
}
