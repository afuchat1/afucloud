import { useRouter } from 'next/router';
import { PageHeader } from '@/components/page-header';
import { ProtectedPage } from '@/components/route-shell';
import { DomainRegistrationPanel } from '@/screens/domain-registration-panel';

export default function DomainRegistrationRoute() {
  const router = useRouter();
  const domainName = router.isReady && typeof router.query.domainName === 'string'
    ? router.query.domainName
    : undefined;

  return (
    <ProtectedPage>
      <div className="space-y-6">
        <PageHeader
          title="Register a domain"
          description="Confirm current availability, review pricing, and complete the legal registrant details."
          docsSection="domains"
        />
        <DomainRegistrationPanel registrationPage initialDomainName={domainName} />
      </div>
    </ProtectedPage>
  );
}
