import DomainsPage from '@/screens/domains';
import { ProtectedPage } from '@/components/route-shell';

export default function DomainsRoute() {
  return <ProtectedPage><DomainsPage /></ProtectedPage>;
}