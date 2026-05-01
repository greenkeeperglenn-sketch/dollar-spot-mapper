import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dollar Spot Monitor",
  description:
    "Environmental disease pressure tracking and photo-based dollar spot assessment.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/stri-logo.png"
                alt="STRI"
                width={108}
                height={40}
                priority
                className="h-8 w-auto"
              />
              <span className="text-base font-semibold tracking-tight">
                Dollar Spot Monitor
              </span>
            </Link>
            <nav className="flex gap-4 text-sm text-stone-600">
              <Link href="/" className="hover:text-stone-900">
                Dashboard
              </Link>
              <Link href="/locations" className="hover:text-stone-900">
                Locations
              </Link>
              <Link href="/assess" className="hover:text-stone-900">
                Assess photo
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
