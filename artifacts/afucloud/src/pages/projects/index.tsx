import ProjectsPage from '@/screens/projects';
import { ProtectedPage } from '@/components/route-shell';

export default function ProjectsRoute() {
  return <ProtectedPage><ProjectsPage /></ProtectedPage>;
}