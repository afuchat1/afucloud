import AnalyticsPage from '@/screens/analytics';
import { ProtectedPage } from '@/components/route-shell';

export default function AnalyticsRoute() {
  return <ProtectedPage><AnalyticsPage /></ProtectedPage>;
}