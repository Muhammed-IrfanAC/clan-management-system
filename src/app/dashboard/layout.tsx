import DashboardLayout from '@/components/layout/DashboardLayout';
import { ClanProvider } from '@/lib/ClanContext';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ClanProvider>
      <DashboardLayout>{children}</DashboardLayout>
    </ClanProvider>
  );
}
