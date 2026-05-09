import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { Navbar } from '@/components/Navbar';

export const metadata: Metadata = {
  title: 'Confidential IRS | FHE-Encrypted Interest Rate Swaps',
  description: 'Privacy-preserving interest rate swaps — notional, rate, and payment direction stay encrypted end-to-end. Powered by Zama FHEVM.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ background: '#000000', colorScheme: 'dark' }}>
      <body style={{ background: '#000000', color: '#ffffff' }}>
        <Providers>
          <Navbar />
          <main style={{ paddingTop: 72 }}>
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
