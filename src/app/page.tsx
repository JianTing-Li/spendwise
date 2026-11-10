import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Dashboard from './dashboard';
import { identify, authorize, canonicalRedirect, PUBLIC_SUBJECT } from '../server/access';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const incoming = await headers();
  const host = incoming.get('host') ?? 'invalid';
  // Deployment-specific URLs would break sign-in (APP-06); send visitors to the production domain.
  const canonical = await canonicalRedirect(incoming.get('host'));
  if (canonical) redirect(canonical);
  const request = new Request(`http://${host}/`, { headers: incoming });
  const access = await identify(request);
  if (access.denied || authorize(access.principal, 'read'))
    return <main className="p-8"><h1>SpendWise access required</h1><p>Sign in with an authorized GitHub account. Hosted access requires operator configuration.</p><form action="/api/auth/signin" method="get"><button type="submit">Sign in with GitHub</button></form></main>;
  return <>
    {access.principal.subject.startsWith("github:") && <form action="/api/auth/signout" method="get"><button type="submit">Sign out</button></form>}
    <Dashboard permissions={access.principal.grant.permissions} signedOut={access.principal.subject === PUBLIC_SUBJECT} />
  </>;
}
