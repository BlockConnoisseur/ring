import type { Metadata } from "next";
import Ring from "@/components/ring";

export const metadata: Metadata = {
  title: "Switchboard — Ring",
  description:
    "Propose a new name, picture, description, website or fee recipient for Ring. Your next call could change the coin.",
};

export default function SwitchboardPage() {
  return <Ring view="switchboard" />;
}
