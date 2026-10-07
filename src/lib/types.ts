export type ProposalKind = "picture" | "description" | "fees";
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
  required: number;
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
  picture: "Token picture",
  description: "Description",
  fees: "Creator fees",
};
