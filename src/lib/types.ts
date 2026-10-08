export const proposalKinds = [
  "name",
  "symbol",
  "picture",
  "description",
  "website",
  "fees",
] as const;
export type ProposalKind = (typeof proposalKinds)[number];
export type Proposal = {
  id: string;
  title: string;
  kind: ProposalKind;
  value: string;
  note: string;
  username: string;
  wallet: string;
  status: string;
  createdAt: number;
  comments: number;
  image?: string;
  transaction?: string;
};
export type PublicState = {
  live: boolean;
  canPost?: boolean;
  feeRecipient?: string | null;
  feePolicy?: string;
  lastGame?: {
    status: string;
    correct: number;
    target: number;
    execution: string | null;
  } | null;
  required: number;
  calls?: { active: number; capacity: number };
  wins: number;
  phone: string | null;
  mint: string | null;
  proposals: Proposal[];
  session: {
    wallet: string;
    eligible: boolean | null;
    cooldownUntil: number;
  } | null;
  queue: { position: number; code?: string; expiresAt?: number } | null;
};
export const labels: Record<ProposalKind, string> = {
  name: "Coin name",
  symbol: "Ticker symbol",
  picture: "Profile picture",
  description: "Description",
  website: "Website link",
  fees: "Fee recipient",
};
