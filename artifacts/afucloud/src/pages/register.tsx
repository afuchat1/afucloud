import RegisterPage from '@/screens/register';
import { GuestPage } from '@/components/route-shell';

export default function RegisterRoute() {
  return <GuestPage><RegisterPage /></GuestPage>;
}