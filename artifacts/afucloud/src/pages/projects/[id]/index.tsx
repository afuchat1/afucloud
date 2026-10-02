import ProjectDetailPage from '@/screens/project-detail';
import { ProtectedPage } from '@/components/route-shell';

export default function ProjectDetailRoute() {
  return <ProtectedPage><ProjectDetailPage /></ProtectedPage>;
}