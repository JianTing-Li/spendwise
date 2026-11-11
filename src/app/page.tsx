import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Dashboard from './dashboard';
import { companyFromParam } from '../companies';
import { identify, authorize, canonicalRedirect, PUBLIC_SUBJECT } from '../server/access';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ company?: string | string[] }> }) {
  const selected = companyFromParam((await searchParams).company);
  const incoming = await headers();
  const host = incoming.get('host') ?? 'invalid';
  // Deployment-specific URLs would break sign-in (APP-06); send visitors to the production domain.
  const canonical = await canonicalRedirect(incoming.get('host'));
  if (canonical) redirect(canonical);
  const request = new Request(`http://${host}/`, { headers: incoming });
  const access = await identify(request);
  if (access.denied || authorize(access.principal, 'read'))
    return (
      <main>
        <header>
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">S</span>
            <span>SpendWise</span>
          </Link>
          <div className="header-actions">
            <span className="environment">Synthetic demo data</span>
          </div>
        </header>
        <section className="access-required">
          <h1>SpendWise access required</h1>
          <p>Sign in with an authorized GitHub account. Hosted access requires operator configuration.</p>
          <form action="/api/auth/signin" method="get">
            <button type="submit">Sign in with GitHub</button>
          </form>
        </section>
      </main>
    );
  return (
    <Dashboard
      initialCompany={selected ?? "roast"}
      permissions={access.principal.grant.permissions}
      signedOut={access.principal.subject === PUBLIC_SUBJECT}
      canSignOut={access.principal.subject.startsWith("github:")}
    />
  );
}
