import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stockwaage",
  description: "Bienenstock-Monitoring",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-stone-100 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
