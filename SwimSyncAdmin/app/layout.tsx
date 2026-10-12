import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "SwimSync Admin",
  description: "Superadmin panel for SwimSync",
  icons: {
    icon: "/icon.png",
    apple: "/apple-touch-icon.png",
  },
};

// DESIGN.md's three weights (400 body, 500 label, 600 headings/buttons). next/font
// self-hosts the files at build time; tailwind's `sans` reads the variable.
const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-geist",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
