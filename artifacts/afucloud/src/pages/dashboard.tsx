import DashboardPage from '@/screens/dashboard';
import { ProtectedPage } from '@/components/route-shell';

export default function DashboardRoute() {
  return <ProtectedPage><DashboardPage /></ProtectedPage>;
}