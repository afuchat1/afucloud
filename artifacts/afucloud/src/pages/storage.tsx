import StoragePage from '@/screens/storage';
import { ProtectedPage } from '@/components/route-shell';

export default function StorageRoute() {
  return <ProtectedPage><StoragePage /></ProtectedPage>;
}