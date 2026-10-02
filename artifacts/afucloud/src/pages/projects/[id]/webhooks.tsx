import ProjectWebhooksPage from '@/screens/project-webhooks';
import { ProtectedPage } from '@/components/route-shell';

export default function ProjectWebhooksRoute() {
  return <ProtectedPage><ProjectWebhooksPage /></ProtectedPage>;
}