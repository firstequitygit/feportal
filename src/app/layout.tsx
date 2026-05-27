import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "sonner";
import { InactivityTimer } from "@/components/inactivity-timer";
import { MaintenanceBanner } from "@/components/maintenance-banner";
import { getAppSettings } from "@/lib/app-settings";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "First Equity Funding | Online Portal",
  description: "First Equity Funding Online Portal",
};

async function getIsSuperAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase
    .from('admin_users')
    .select('is_super')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  return data?.is_super === true
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [settings, isSuperAdmin] = await Promise.all([
    getAppSettings(),
    getIsSuperAdmin(),
  ])
  const idleTimeoutMs = settings.idle_timeout_hours * 60 * 60 * 1000
  const bannerSignature = `${settings.maintenance_banner_enabled}:${settings.maintenance_banner_message}`

  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <MaintenanceBanner
          enabled={settings.maintenance_banner_enabled}
          message={settings.maintenance_banner_message}
          isSuperAdmin={isSuperAdmin}
          signature={bannerSignature}
        />
        <InactivityTimer idleTimeoutMs={idleTimeoutMs} />
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
