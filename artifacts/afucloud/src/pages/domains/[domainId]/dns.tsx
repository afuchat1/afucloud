import DomainDnsPage from '@/screens/domain-dns';
import { ProtectedPage } from '@/components/route-shell';

export default function DomainDnsRoute() {
  return <ProtectedPage><DomainDnsPage /></ProtectedPage>;
}