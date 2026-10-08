import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource/space-mono/400.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ring — The coin is on the line.",
  description:
    "Hold Ring. Propose a change. Call the coin and earn your say, one right answer at a time.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ring:theme:v1');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
