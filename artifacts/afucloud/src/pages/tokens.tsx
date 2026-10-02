import TokensPage from '@/screens/tokens';
import { ProtectedPage } from '@/components/route-shell';

export default function TokensRoute() {
  return <ProtectedPage><TokensPage /></ProtectedPage>;
}