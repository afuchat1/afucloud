import ProjectApiKeysPage from '@/screens/project-api-keys';
import { ProtectedPage } from '@/components/route-shell';

export default function ProjectApiKeysRoute() {
  return <ProtectedPage><ProjectApiKeysPage /></ProtectedPage>;
}