import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "sonner";
import { InactivityTimer } from "@/components/inactivity-timer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "First Equity Funding | Online Portal",
  description: "First Equity Funding Online Portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <InactivityTimer />
        <div className="flex-1">
          {children}
        </div>
        <footer className="w-full py-4 px-4 text-center text-xs text-gray-500" style={{ backgroundColor: '#F9FAFB', borderTop: '1px solid #e5e7eb' }}>
          <p>© 2026 by First Equity Funding LP. All Rights Reserved.</p>
        </footer>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
