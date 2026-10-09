import type { Metadata } from "next";
import Ring from "@/components/ring";

export const metadata: Metadata = {
  title: "Claim fees — Ring",
  description:
    "View and claim Ring's Meteora trading fees with the authorized fee wallet.",
};
export default function FeesPage() {
  return <Ring view="fees" />;
}
