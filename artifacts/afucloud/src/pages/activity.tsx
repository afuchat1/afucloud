import ActivityPage from '@/screens/activity';
import { ProtectedPage } from '@/components/route-shell';

export default function ActivityRoute() {
  return <ProtectedPage><ActivityPage /></ProtectedPage>;
}