import SettingsPage from '@/screens/settings';
import { ProtectedPage } from '@/components/route-shell';

export default function SettingsRoute() {
  return <ProtectedPage><SettingsPage /></ProtectedPage>;
}