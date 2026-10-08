import type { Metadata } from "next";
import Ring from "@/components/ring";

export const metadata: Metadata = {
  title: "How to play — Ring",
  description:
    "Hold Ring, post a proposal, enter your four-digit code and answer the phone quiz. Learn the rules before you call.",
};

export default function RulesPage() {
  return <Ring view="rules" />;
}
