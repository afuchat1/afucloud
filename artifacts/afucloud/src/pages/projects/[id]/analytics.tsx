import ProjectAnalyticsPage from '@/screens/project-analytics';
import { ProtectedPage } from '@/components/route-shell';

export default function ProjectAnalyticsRoute() {
  return <ProtectedPage><ProjectAnalyticsPage /></ProtectedPage>;
}