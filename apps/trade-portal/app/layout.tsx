import type { Metadata } from 'next';
import './globals.css';
import SidebarWrapper from './SidebarWrapper';

export const metadata: Metadata = {
  title: 'Outlight Trade Portal',
  description: 'Trade member portal for Outlight',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ height: '100%' }}>
      <body style={{ margin: 0, minHeight: '100%', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#fafaf9', color: '#1a1a1a' }}>
        <SidebarWrapper>{children}</SidebarWrapper>
      </body>
    </html>
  );
}
