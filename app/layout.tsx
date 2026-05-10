import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/context/AuthContext";
import { I18nProvider } from "@/lib/context/I18nContext";
import AppShell from "@/components/AppShell";
import { AIChat } from "@/components/AIChat";

export const metadata: Metadata = {
  title: "Axira Trading FZE",
  description: "Axira Trading FZE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <I18nProvider>
          <AuthProvider>
            <AppShell>{children}</AppShell>
            <AIChat />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
