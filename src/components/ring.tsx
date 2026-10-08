"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import bs58 from "bs58";
import {
  labels,
  proposalKinds,
  type Proposal,
  type ProposalKind,
  type PublicState,
} from "@/lib/types";

type WalletProvider = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (
    message: Uint8Array,
    encoding?: string,
  ) => Promise<{ signature: Uint8Array }>;
  disconnect?: () => Promise<void>;
};
declare global {
  interface Window {
    phantom?: { solana?: WalletProvider };
    solflare?: WalletProvider;
  }
}
type Draft = {
  title: string;
  kind: ProposalKind;
  value: string;
  note: string;
  username: string;
  image?: string;
};
type Panel = "wallet" | "proposal" | "call" | "detail" | null;
const initial: PublicState = {
  live: false,
  required: 3,
  wins: 0,
  phone: null,
  mint: null,
  proposals: [],
  session: null,
  queue: null,
};
const blank: Draft = {
  title: "",
  kind: "picture",
  value: "",
  note: "",
  username: "",
  image: "",
};
const starters: {
  kind: ProposalKind;
  title: string;
  text: string;
  number: string;
}[] = [
  {
    kind: "picture",
    title: "Give Ring a new face.",
    text: "Your image. On the actual token.",
    number: "01",
  },
  {
    kind: "description",
    title: "Put it in your own words.",
    text: "Rewrite the token description.",
    number: "02",
  },
  {
    kind: "fees",
    title: "Send the fees somewhere else.",
    text: "Choose the wallet that receives creator fees.",
    number: "03",
  },
];
function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"} />
    </svg>
  );
}
function BrandLogo() {
  return (
    <span className="brand-lockup" aria-hidden="true">
      <Image src="/ring-mark.svg" alt="" width={44} height={44} />
      <span className="brand-lettering">
        R<span>I</span>NG
      </span>
    </span>
  );
}
function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M5 4 2.8 6.2c-.8.8 1 6 4.8 9.8s9 5.6 9.8 4.8L20 18l-4.5-3-2 2c-2.6-1.3-5.2-4-6.5-6.5l2-2L6 4Z" />
    </svg>
  );
}
async function api<T>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(
    `/api/${path}`,
    data === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const body = await res.json();
  if (!res.ok)
    throw new Error(
      body.error || "Something interrupted the connection. Try again.",
    );
  return body;
}
const short = (wallet: string) => `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

export default function Ring({
  view = "home",
}: {
  view?: "home" | "switchboard" | "rules";
}) {
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || "dark");
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("ring:theme:v1", next);
    } catch {}
  }
  const [state, setState] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [filter, setFilter] = useState("all");
  const [draft, setDraft] = useState<Draft>(blank);
  const [savedDraft, setSavedDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [comments, setComments] = useState<
    { id: string; wallet: string; text: string }[]
  >([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(0);
  const [pickedUp, setPickedUp] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await api<PublicState>("state");
      if (next.session && next.queue) {
        try {
          const stored = JSON.parse(
            sessionStorage.getItem(`ring:code:${next.session.wallet}`) ||
              "null",
          );
          if (stored?.expiresAt === next.queue.expiresAt)
            next.queue.code = stored.code;
        } catch {}
      }
      setState(next);
      setSelected((current) =>
        current
          ? next.proposals.find((p) => p.id === current.id) || current
          : null,
      );
      setNetworkError("");
    } catch {
      setNetworkError(
        "The switchboard is temporarily unavailable. Your local drafts are safe.",
      );
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    try {
      const raw = localStorage.getItem("ring:draft:v1");
      if (raw) {
        const saved = JSON.parse(raw);
        if (
          saved &&
          typeof saved.title === "string" &&
          proposalKinds.includes(saved.kind)
        )
          setSavedDraft(saved);
      }
    } catch {
      /* Storage can be disabled. */
    }
    return () => {
      clearInterval(id);
      clearInterval(clock);
    };
  }, [refresh]);
  useEffect(() => {
    if (panel) dialog.current?.showModal();
    else dialog.current?.close();
  }, [panel]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const cooldown = Math.max(0, (state.session?.cooldownUntil || 0) - now);
  const secondsLeft = Math.ceil(cooldown / 1000);
  const countdown = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;
  function open(next: Panel) {
    setError("");
    setPanel(next);
  }
  function compose(kind?: ProposalKind) {
    setDraft(kind ? { ...blank, kind } : savedDraft || blank);
    open("proposal");
  }
  async function connect(providerName: "phantom" | "solflare") {
    setBusy(true);
    setError("");
    try {
      const provider =
        providerName === "phantom" ? window.phantom?.solana : window.solflare;
      if (!provider)
        throw new Error(
          `${providerName === "phantom" ? "Phantom" : "Solflare"} was not found. Open Ring in your wallet’s browser or install its browser extension.`,
        );
      const connected = await provider.connect();
      const wallet = connected.publicKey.toString();
      const challenge = await api<{ id: string; message: string }>(
        "auth/challenge",
        { wallet },
      );
      const signed = await provider.signMessage(
        new TextEncoder().encode(challenge.message),
        "utf8",
      );
      await api("auth/verify", {
        id: challenge.id,
        signature: bs58.encode(signed.signature),
      });
      await refresh();
      setPanel(null);
      setNotice("Wallet connected. No transaction was requested.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection cancelled.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG, or WebP image under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((prev) => ({
        ...prev,
        image: String(reader.result),
        value: file.name,
      }));
      setError("");
    };
    reader.readAsDataURL(file);
  }
  function saveDraft() {
    try {
      localStorage.setItem("ring:draft:v1", JSON.stringify(draft));
      setSavedDraft(draft);
      setPanel(null);
      setNotice("Draft saved on this device. It hasn’t been posted.");
    } catch {
      setError("There isn’t enough browser storage. Try a smaller image.");
    }
  }
  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!state.session) {
      setError(
        "Connect your wallet before posting. You can save a draft below.",
      );
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ id: string; call: PublicState["queue"] }>(
        "proposals",
        draft,
      );
      localStorage.removeItem("ring:draft:v1");
      setSavedDraft(null);
      await refresh();
      if (result.call?.code) {
        try {
          sessionStorage.setItem(
            `ring:code:${state.session.wallet}`,
            JSON.stringify(result.call),
          );
        } catch {}
        setState((prev) => ({ ...prev, queue: result.call }));
        open("call");
        setNotice(
          "Proposal posted. Enter your private four-digit code when you call.",
        );
      } else {
        const posted = await api<{ proposal: Proposal }>(
          `proposals/${result.id}`,
        );
        setSelected(posted.proposal);
        open("detail");
        setNotice(
          "Proposal posted. Get a call code here when you’re ready and the line is open.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function detail(proposal: Proposal) {
    setSelected(proposal);
    setComments([]);
    setComment("");
    open("detail");
    try {
      const data = await api<{ comments: typeof comments }>(
        `proposals/${proposal.id}`,
      );
      setComments(data.comments);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function join() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        code: string;
        expiresAt: number;
        position: number;
      }>("queue", { proposalId: selected.id });
      try {
        sessionStorage.setItem(
          `ring:code:${state.session!.wallet}`,
          JSON.stringify(result),
        );
      } catch {}
      await refresh();
      setState((prev) => ({ ...prev, queue: result }));
      open("call");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api(`proposals/${selected.id}/comments`, { text: comment });
      setComment("");
      const data = await api<{ comments: typeof comments }>(
        `proposals/${selected.id}`,
      );
      setComments(data.comments);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function queueAction(action: "code" | "cancel") {
    setBusy(true);
    setError("");
    try {
      const result = await api<NonNullable<PublicState["queue"]>>(
        `queue/${action}`,
        {},
      );
      if (action === "code")
        sessionStorage.setItem(
          `ring:code:${state.session!.wallet}`,
          JSON.stringify(result),
        );
      else sessionStorage.removeItem(`ring:code:${state.session!.wallet}`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = state.proposals.filter(
    (p) => filter === "all" || p.kind === filter,
  );

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="masthead">
        <header className="site-header wrap">
          <a className="wordmark" href="/" aria-label="Ring home">
            <BrandLogo />
          </a>
          <nav aria-label="Main navigation">
            <a
              href="/switchboard"
              aria-current={view === "switchboard" ? "page" : undefined}
            >
              Switchboard
            </a>
            <a
              href="/rules"
              aria-current={view === "rules" ? "page" : undefined}
            >
              How to play
            </a>
          </nav>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              {theme === "dark" ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
                </>
              ) : (
                <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" />
              )}
            </svg>
          </button>
          <button className="wallet-button" onClick={() => open("wallet")}>
            <svg
              className="wallet-symbol"
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M4 6h15v14H4V6Zm0 0V4h12v2M15 11h6v5h-6z" />
            </svg>
            {state.session ? short(state.session.wallet) : "Connect wallet"}
            <Arrow diagonal />
          </button>
        </header>
      </div>
      <main id="main" className={`page-${view}`}>
        {view === "home" && (
          <>
            <section className="hero wrap" aria-labelledby="hero-title">
              <div className="hero-copy">
                <p className="eyebrow">
                  <span className="red-dash" /> A memecoin with a phone number
                </p>
                <h1 id="hero-title">
                  The coin
                  <br />
                  is on
                  <br />
                  the <span>line.</span>
                </h1>
                <p className="hero-description">
                  Call Ring. Answer the questions.
                  <br />
                  Win the right to change the coin.
                </p>
                <button className="primary-button" onClick={() => compose()}>
                  Make a proposal <Arrow diagonal />
                </button>
                <p className="hero-footnote">
                  Hold any amount of Ring. Have your say.
                </p>
              </div>
              <div className={`phone-scene ${pickedUp ? "picked-up" : ""}`}>
                <span className="phone-note">
                  YOUR CALL.
                  <br />
                  YOUR COIN.
                </span>
                <button
                  className="phone-object"
                  aria-label="Pick up the red telephone"
                  onClick={() => {
                    setPickedUp(true);
                    open("call");
                  }}
                >
                  <Image
                    src="/ring-phone.png"
                    alt="A red vintage landline with its receiver lifted off the hook"
                    width={1120}
                    height={1400}
                    priority
                    sizes="(max-width: 700px) 85vw, 48vw"
                  />
                </button>
                <div className="phone-caption">
                  <span className="status-dot" />
                  <span>
                    {state.live ? "The line is open" : "The line opens soon"}
                  </span>
                  <span className="caption-rule" />
                  <span>EST. 2026</span>
                </div>
              </div>
            </section>
            <div
              className="rule-strip wrap"
              aria-label="Game rules at a glance"
            >
              <div>
                <strong>{String(state.required).padStart(2, "0")}</strong>
                <span>
                  right answers
                  <br />
                  to make a change
                </span>
              </div>
              <div>
                <strong>
                  08<span>s</span>
                </strong>
                <span>
                  to answer
                  <br />
                  each question
                </span>
              </div>
              <div>
                <strong>
                  10<span>m</span>
                </strong>
                <span>
                  between attempts
                  <br />
                  per wallet
                </span>
              </div>
              <a href="/rules">
                Know the rules <Arrow diagonal />
              </a>
            </div>
            <section className="home-dispatch wrap">
              <div className="dispatch-heading">
                <h2>
                  The next version
                  <br />
                  could be yours.
                </h2>
                <p>
                  A new face. A new name. A different place for the fees. Put
                  your idea on the board, then earn it on the phone.
                </p>
                <a className="text-button" href="/switchboard">
                  Explore the switchboard <Arrow diagonal />
                </a>
              </div>
              <div className="dispatch-options">
                {(["name", "picture", "fees"] as ProposalKind[]).map((kind) => (
                  <button key={kind} onClick={() => compose(kind)}>
                    <span>
                      {kind === "name"
                        ? "Name the coin."
                        : kind === "picture"
                          ? "Change the face."
                          : "Direct the fees."}
                    </span>
                    <Arrow diagonal />
                  </button>
                ))}
              </div>
            </section>
            <section className="hotline-banner">
              <div className="wrap">
                <div>
                  <span className="hotline-label">
                    The number is real. The change is yours to earn.
                  </span>
                  <h2 className="hotline-number">
                    {state.phone || "+14433489296"}
                  </h2>
                </div>
                <button onClick={() => open("call")} className="hotline-action">
                  {state.live ? "Before you call" : "The line opens soon"}
                  <Arrow diagonal />
                </button>
              </div>
            </section>
          </>
        )}
        {view === "switchboard" && (
          <section
            className="switchboard wrap"
            id="switchboard"
            aria-labelledby="board-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">The community has the receiver</p>
                <h1 id="board-title">
                  The switchboard<span className="brand-dot">.</span>
                </h1>
                <p className="page-intro">
                  Pick a change. Make your case. Your call decides what happens
                  next.
                </p>
              </div>
              <button className="text-button" onClick={() => compose()}>
                Propose a change <span className="plus">+</span>
              </button>
            </div>
            <div className="board-layout">
              <div className="board-main">
                <div className="board-filters" aria-label="Filter proposals">
                  {[["all", "All proposals"], ...Object.entries(labels)].map(
                    ([key, label]) => (
                      <button
                        key={key}
                        aria-pressed={filter === key}
                        className={filter === key ? "active" : ""}
                        onClick={() => setFilter(key)}
                      >
                        {label}
                      </button>
                    ),
                  )}
                  <span>{filtered.length.toString().padStart(2, "0")}</span>
                </div>
                {networkError ? (
                  <div className="empty-state" role="status">
                    <p>{networkError}</p>
                    <button
                      className="text-button"
                      onClick={() => void refresh()}
                    >
                      Try again <Arrow />
                    </button>
                  </div>
                ) : !loaded ? (
                  <div className="empty-state" role="status">
                    Connecting to the switchboard…
                  </div>
                ) : filtered.length ? (
                  <div className="proposal-list">
                    {filtered.map((p) => (
                      <button
                        className="proposal-row"
                        key={p.id}
                        onClick={() => void detail(p)}
                      >
                        <span className="proposal-type">
                          {p.kind === "picture"
                            ? "IMG"
                            : p.kind === "fees"
                              ? "SOL"
                              : "TXT"}
                        </span>
                        <span className="proposal-row-copy">
                          <span className="proposal-meta">
                            {labels[p.kind]} <span>by @{p.username}</span>
                          </span>
                          <strong>{p.title}</strong>
                          <span className="proposal-note">
                            {p.note || p.value}
                          </span>
                        </span>
                        <span className="proposal-status">
                          {p.status.replaceAll("_", " ")}
                          <Arrow diagonal />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <span className="empty-number">
                      ({" "}
                      {filter === "all"
                        ? "YOUR IDEA GOES HERE"
                        : `NO ${filter.toUpperCase()} PROPOSALS YET`}{" "}
                      )
                    </span>
                    <h3>
                      Nothing on the line.
                      <br />
                      Yet.
                    </h3>
                    <p>
                      The first proposal could be yours.
                      <br />
                      Pick something worth calling about.
                    </p>
                    <button
                      className="text-button"
                      onClick={() =>
                        compose(
                          filter === "all"
                            ? undefined
                            : (filter as ProposalKind),
                        )
                      }
                    >
                      Start a proposal <Arrow />
                    </button>
                  </div>
                )}
                {savedDraft && (
                  <div>
                    <button className="draft-row" onClick={() => compose()}>
                      <span>
                        <small>PRIVATE DRAFT · THIS DEVICE</small>
                        <strong>
                          {savedDraft.title || "Your unfinished proposal"}
                        </strong>
                      </span>
                      <span>
                        Continue <Arrow />
                      </span>
                    </button>
                    <button
                      className="inline-link"
                      onClick={() => {
                        try {
                          localStorage.removeItem("ring:draft:v1");
                          setSavedDraft(null);
                          setNotice("Private draft discarded.");
                        } catch {
                          setNotice("Browser storage is unavailable.");
                        }
                      }}
                    >
                      Discard private draft
                    </button>
                  </div>
                )}
                <div className="starter-heading">
                  What can you change? <span>Pick a starting point</span>
                </div>
                {starters.map((item) => (
                  <button
                    className="starter-row"
                    key={item.kind}
                    onClick={() => compose(item.kind)}
                  >
                    <span className="starter-number">{item.number}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.text}</small>
                    </span>
                    <Arrow diagonal />
                  </button>
                ))}
              </div>
              <aside className="call-slip">
                <div className="slip-top">
                  <span className="eyebrow">Ring hotline</span>
                  <PhoneIcon />
                </div>
                <span className="line-status">
                  <span className="status-dot" />
                  {state.live ? "Accepting calls" : "Not taking calls yet"}
                </span>
                <h3 className={state.phone ? "hotline-number" : undefined}>
                  {state.phone ? (
                    state.phone
                  ) : (
                    <>
                      Good things
                      <br />
                      are on
                      <br />
                      the line.
                    </>
                  )}
                </h3>
                <p>
                  Submit your change first.
                  <br />
                  Then pick up the phone.
                </p>
                <div className="slip-divider" />
                <dl>
                  <div>
                    <dt>Current target</dt>
                    <dd>{state.required} in a row</dd>
                  </div>
                  <div>
                    <dt>Next target after a win</dt>
                    <dd>{state.required + 2} in a row</dd>
                  </div>
                  <div>
                    <dt>Your next attempt</dt>
                    <dd>
                      {cooldown
                        ? countdown
                        : state.session
                          ? "Ready"
                          : "Connect wallet"}
                    </dd>
                  </div>
                </dl>
                <button className="slip-button" onClick={() => open("call")}>
                  {state.live ? "Get ready to call" : "Before you call"}
                  <Arrow diagonal />
                </button>
                <span className="slip-bottom">
                  Fresh questions. Every single call.
                </span>
              </aside>
            </div>
          </section>
        )}
        {view === "rules" && (
          <section className="rules-section" id="rules">
            <div className="wrap rules-grid">
              <div>
                <p className="eyebrow">Read before you ring</p>
                <h1>
                  A little knowledge.
                  <br />A lot of <span>power.</span>
                </h1>
                <p>
                  You don’t need a big bag.
                  <br />
                  Just a little Ring and the right answers.
                </p>
                <div
                  className="progression"
                  aria-label="Required streak increases from 3 to 5 to 7 to 9"
                >
                  <strong>3</strong>
                  <span>→</span>
                  <strong>5</strong>
                  <span>→</span>
                  <strong>7</strong>
                  <span>→</span>
                  <strong>9</strong>
                  <span>↗</span>
                </div>
                <span className="progression-caption">
                  Every win adds two questions for new games. Your target stays
                  locked once your game starts.
                </span>
              </div>
              <div className="rules-list">
                {[
                  [
                    "Hold a little Ring.",
                    "Connect your wallet and sign in. Any positive token balance counts. We check before you play and before your change is applied.",
                  ],
                  [
                    "Put your idea on the board.",
                    "Choose a change from the dropdown and post exactly what you want. Your private four-digit code connects that proposal to your call.",
                  ],
                  [
                    "Call. Think fast.",
                    "Use your private code to link the phone call. Say A, B, C, or D, or press 1, 2, 3, or 4. You get eight seconds after the beep.",
                  ],
                  [
                    "Earn the change.",
                    "Get the whole streak right and your proposal is queued to execute. Miss one and the run ends. Your next attempt is ten minutes after you started.",
                  ],
                ].map(([title, copy], i) => (
                  <div className="rule-item" key={title}>
                    <span>0{i + 1}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{copy}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
        {view !== "home" && (
          <section className="last-call wrap">
            <p>Something you’d change?</p>
            <button onClick={() => compose()}>
              Let’s hear it.
              <Arrow diagonal />
            </button>
          </section>
        )}
      </main>
      <div className="brand-band">
        <footer className="site-footer wrap">
          <a className="wordmark" href="/" aria-label="Ring home">
            <BrandLogo />
          </a>
          <p>Pick up the future.</p>
          <span>Solana / Meteora</span>
          <a href="/rules">
            Rules <Arrow diagonal />
          </a>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className={`panel panel-${panel || "closed"}`}
        onCancel={() => setPanel(null)}
        onClose={() => {
          setPanel(null);
          setPickedUp(false);
        }}
        onClick={(e) => {
          if (e.target === dialog.current) setPanel(null);
        }}
        aria-labelledby="panel-title"
      >
        <div className="panel-content">
          <button
            className="close-button"
            aria-label="Close dialog"
            onClick={() => setPanel(null)}
          >
            ×
          </button>
          {panel === "wallet" && (
            <>
              <p className="eyebrow">Your seat at the switchboard</p>
              <h2 id="panel-title">
                Connect.
                <br />
                Then call.
              </h2>
              {state.session ? (
                <>
                  <p>
                    Connected as <strong>{short(state.session.wallet)}</strong>.
                  </p>
                  <p>
                    {state.session.eligible === null
                      ? "The Ring mint hasn’t been announced. Holding checks begin when it is configured."
                      : state.session.eligible
                        ? "You hold Ring. Any positive balance qualifies."
                        : "This wallet doesn’t currently hold Ring."}
                  </p>
                  <button
                    className="primary-button"
                    onClick={async () => {
                      await api("auth/logout", {});
                      await refresh();
                      setPanel(null);
                    }}
                  >
                    Disconnect wallet <Arrow />
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Sign a message to prove this wallet is yours. Signing in
                    doesn’t move any tokens.
                  </p>
                  <div className="wallet-options">
                    <button
                      disabled={busy}
                      onClick={() => void connect("phantom")}
                    >
                      <span className="provider-mark">P</span>
                      <strong>Phantom</strong>
                      <Arrow diagonal />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void connect("solflare")}
                    >
                      <span className="provider-mark">S</span>
                      <strong>Solflare</strong>
                      <Arrow diagonal />
                    </button>
                  </div>
                  <p className="small-copy">
                    On mobile, open this website inside your wallet’s browser.
                  </p>
                </>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
          {panel === "proposal" && (
            <>
              <p className="eyebrow">Your idea, on the line</p>
              <h2 id="panel-title">Make a change.</h2>
              <p>One proposal. One change. Make it worth the call.</p>
              <form onSubmit={publish}>
                <label className="field-label" htmlFor="proposal-kind">
                  What are we changing?
                </label>
                <select
                  id="proposal-kind"
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      kind: e.target.value as ProposalKind,
                      value: "",
                      image: "",
                    }))
                  }
                >
                  {Object.entries(labels).map(([kind, label]) => (
                    <option key={kind} value={kind}>
                      {label}
                    </option>
                  ))}
                </select>
                <label className="field-label" htmlFor="title">
                  Give it a title
                </label>
                <input
                  id="title"
                  placeholder="Say what you want to change"
                  value={draft.title}
                  maxLength={100}
                  required
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
                <label className="field-label" htmlFor="username">
                  Your forum name
                </label>
                <div className="input-prefix">
                  <span>@</span>
                  <input
                    id="username"
                    placeholder="yourname"
                    value={draft.username}
                    pattern="[A-Za-z0-9_]{3,24}"
                    minLength={3}
                    maxLength={24}
                    required
                    onChange={(e) =>
                      setDraft({ ...draft, username: e.target.value })
                    }
                  />
                </div>
                {draft.kind === "picture" ? (
                  <>
                    <label className="field-label" htmlFor="picture">
                      The new token picture
                    </label>
                    <label className="upload-area" htmlFor="picture">
                      {draft.image ? (
                        <img
                          src={draft.image}
                          alt="Your proposed token picture"
                        />
                      ) : (
                        <span className="upload-plus">+</span>
                      )}
                      <span>
                        {draft.image
                          ? "Choose a different image"
                          : "Choose an image"}
                        <small>PNG, JPEG, WEBP · UP TO 2 MB</small>
                      </span>
                      <input
                        id="picture"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => void upload(e.target.files?.[0])}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field-label" htmlFor="value">
                      {draft.kind === "fees"
                        ? "Recipient Solana wallet"
                        : draft.kind === "name"
                          ? "The new coin name"
                          : draft.kind === "symbol"
                            ? "The new ticker symbol"
                            : draft.kind === "website"
                              ? "The new website link"
                              : "The new description"}
                    </label>
                    {draft.kind === "description" ? (
                      <textarea
                        id="value"
                        required
                        maxLength={500}
                        rows={4}
                        value={draft.value}
                        onChange={(e) =>
                          setDraft({ ...draft, value: e.target.value })
                        }
                        placeholder="What should Ring say about itself?"
                      />
                    ) : (
                      <input
                        id="value"
                        type={draft.kind === "website" ? "url" : "text"}
                        maxLength={
                          draft.kind === "name"
                            ? 32
                            : draft.kind === "symbol"
                              ? 10
                              : draft.kind === "fees"
                                ? 44
                                : 500
                        }
                        pattern={
                          draft.kind === "symbol"
                            ? "[A-Za-z0-9]{1,10}"
                            : undefined
                        }
                        required
                        value={draft.value}
                        onChange={(e) =>
                          setDraft({ ...draft, value: e.target.value })
                        }
                        placeholder={
                          draft.kind === "name"
                            ? "Give the coin a new name"
                            : draft.kind === "symbol"
                              ? "RING"
                              : draft.kind === "website"
                                ? "https://your-site.com"
                                : "Paste the full wallet address"
                        }
                      />
                    )}
                  </>
                )}
                <label className="field-label" htmlFor="note">
                  Make your case <span>(optional)</span>
                </label>
                <textarea
                  id="note"
                  rows={2}
                  maxLength={500}
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="Why this change?"
                />
                <div className="proposal-disclosure">
                  {state.canPost
                    ? "Post your proposal to get a private four-digit call code when the line is open. Codes expire after ten minutes."
                    : "Ring is in prelaunch. You can save your idea as a private draft now."}
                  {draft.kind === "fees" &&
                    " Your chosen wallet receives Ring’s creator fees until the next fee proposal is applied. Previous fees settle first. SOL payouts arrive as wrapped SOL."}
                </div>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="form-actions">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={busy || !state.canPost}
                  >
                    {busy ? "Posting…" : "Post proposal"}
                    <Arrow />
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={saveDraft}
                  >
                    Save draft
                  </button>
                </div>
                {!state.session && (
                  <button
                    className="inline-link"
                    type="button"
                    onClick={() => {
                      try {
                        localStorage.setItem(
                          "ring:draft:v1",
                          JSON.stringify(draft),
                        );
                        setSavedDraft(draft);
                      } catch {}
                      open("wallet");
                    }}
                  >
                    Connect wallet to post ↗
                  </button>
                )}
              </form>
            </>
          )}
          {panel === "call" && (
            <>
              <p className="eyebrow">Ring hotline</p>
              <h2 id="panel-title">
                {state.live
                  ? "You’re on the line."
                  : "Almost time\nto pick up."}
              </h2>
              <p>
                {state.live
                  ? "Enter your private four-digit code on the phone keypad. It links the call to your wallet and locked proposal."
                  : "The real phone line opens when Ring launches. Have your proposal ready."}
              </p>
              <div className="call-checklist">
                <div>
                  <span>01</span>
                  <p>
                    Connect a wallet
                    <strong>
                      {state.session
                        ? short(state.session.wallet)
                        : "Your identity on Ring"}
                    </strong>
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <p>
                    Hold any amount of Ring
                    <strong>
                      {!state.mint
                        ? "Token address to be announced"
                        : state.session?.eligible
                          ? "Holding requirement met"
                          : "Balance verified before your call"}
                    </strong>
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <p>
                    Lock your proposal
                    <strong>
                      {state.queue
                        ? state.lastGame?.status === "playing"
                          ? "Your call is in progress"
                          : "Your private code is ready"
                        : "Pick the change you’re playing for"}
                    </strong>
                  </p>
                </div>
              </div>
              {state.queue?.code && (
                <div className="call-code">
                  <span>YOUR PRIVATE CALL CODE</span>
                  <strong>{state.queue.code}</strong>
                  <small>
                    Expires{" "}
                    {new Date(state.queue.expiresAt!).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    . Never share it.
                  </small>
                </div>
              )}
              {cooldown > 0 ? (
                <p className="form-error">
                  Your next attempt is in {countdown}.
                </p>
              ) : null}
              {state.lastGame && (
                <p className="proposal-disclosure" aria-live="polite">
                  {state.lastGame.status === "playing"
                    ? `On the call: ${state.lastGame.correct} of ${state.lastGame.target} correct.`
                    : state.lastGame.execution === "applied"
                      ? "You won. Your token change is confirmed."
                      : state.lastGame.execution === "holding_required"
                        ? "You won. Hold Ring in your connected wallet to apply your change."
                        : state.lastGame.status === "won"
                          ? "You won. Your change is waiting for chain confirmation."
                          : state.lastGame.status === "void"
                            ? "The call had a technical problem. Your attempt was restored."
                            : "Your last run ended. Try again when your cooldown expires."}
                </p>
              )}
              {state.queue && state.lastGame?.status !== "playing" && (
                <div className="form-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void queueAction("code")}
                  >
                    Get a new private code
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void queueAction("cancel")}
                  >
                    Leave queue
                  </button>
                </div>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {state.live && state.phone && state.queue ? (
                <a className="primary-button" href={`tel:${state.phone}`}>
                  <PhoneIcon />
                  Call {state.phone}
                </a>
              ) : (
                <button
                  className="primary-button"
                  onClick={() => (state.session ? compose() : open("wallet"))}
                >
                  {state.session ? "Prepare a proposal" : "Connect your wallet"}
                  <Arrow />
                </button>
              )}
              <p className="small-copy">
                {state.lastGame?.status === "playing"
                  ? state.lastGame.target
                  : state.required}{" "}
                right in a row. Eight seconds per answer. Your target locks when
                your call starts.
                {state.calls &&
                  ` ${state.calls.active} of ${state.calls.capacity} call slots in use.`}
              </p>
            </>
          )}
          {panel === "detail" && selected && (
            <>
              <p className="eyebrow">
                {labels[selected.kind]} / {selected.status.replaceAll("_", " ")}
              </p>
              <h2 id="panel-title">{selected.title}</h2>
              <p className="detail-author">
                Proposed by @{selected.username} · {short(selected.wallet)}
              </p>
              {selected.image && (
                <img
                  className="detail-image"
                  src={selected.image}
                  alt="Proposed token picture"
                />
              )}
              <div className="proposal-value">{selected.value}</div>
              {selected.note && <p>{selected.note}</p>}
              {selected.transaction && (
                <a
                  className="inline-link"
                  href={`https://explorer.solana.com/tx/${selected.transaction}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View confirmed transaction ↗
                </a>
              )}
              {state.session?.wallet === selected.wallet &&
                selected.status === "open" && (
                  <button
                    className="primary-button"
                    disabled={busy || cooldown > 0}
                    onClick={() => void join()}
                  >
                    {cooldown
                      ? `Next attempt in ${countdown}`
                      : "Lock proposal & join queue"}
                    <Arrow />
                  </button>
                )}
              <h3 className="comments-title">
                On the board <span>{comments.length}</span>
              </h3>
              {comments.length === 0 ? (
                <p className="small-copy">
                  No comments yet. What do you think?
                </p>
              ) : (
                comments.map((c) => (
                  <div className="comment" key={c.id}>
                    <small>{short(c.wallet)}</small>
                    <p>{c.text}</p>
                  </div>
                ))
              )}
              <form onSubmit={addComment}>
                <label className="field-label" htmlFor="comment">
                  Add your comment
                </label>
                <textarea
                  id="comment"
                  rows={3}
                  maxLength={500}
                  required
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button
                  className="text-button"
                  disabled={!state.session || busy}
                >
                  Post comment <Arrow />
                </button>
              </form>
              {!state.session && (
                <button className="inline-link" onClick={() => open("wallet")}>
                  Connect your wallet to comment
                </button>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
