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
  title: "Desco Financial | Online Portal",
  description: "Desco Financial Online Portal",
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
        <footer className="w-full py-4 px-4 text-center text-xs text-gray-500" style={{ backgroundColor: '#FFF6EF', borderTop: '1px solid #e8ddd6' }}>
          <p>
            © 2026 by DESCO Financial LLC. All Rights Reserved.
            {' · '}
            <a href="https://www.descofinancial.com/privacy" target="_blank" rel="noopener noreferrer" className="footer-link">Privacy Policy</a>
            {' · '}
            <a href="https://www.descofinancial.com/terms" target="_blank" rel="noopener noreferrer" className="footer-link">Terms of Use</a>
          </p>
        </footer>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
