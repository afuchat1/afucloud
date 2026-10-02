import LoginPage from '@/screens/login';
import { GuestPage } from '@/components/route-shell';

export default function LoginRoute() {
  return <GuestPage><LoginPage /></GuestPage>;
}