import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SOF-Track',
  description: 'Sledovanie výpalkov a pripravenosti zostáv pre zámočníkov',
  manifest: '/manifest.json',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body>{children}</body>
    </html>
  );
}
