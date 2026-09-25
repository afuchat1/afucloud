const actionLabels: Record<string, string> = {
  upload: 'Uploaded',
  delete: 'Deleted',
  update: 'Updated',
  create: 'Created',
  register: 'Created account',
  login: 'Signed in',
  revoke: 'Revoked',
  restore: 'Restored',
};

const resourceLabels: Record<string, string> = {
  api_key: 'API key',
  personal_token: 'personal token',
  image: 'image',
  project: 'project',
  webhook: 'webhook',
  user: 'account',
};

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ');
}

export function describeActivity(action: string, resource: string): string {
  const verb = actionLabels[action] ?? humanize(action);
  if (action === 'login' || action === 'register') return verb;
  const noun = resourceLabels[resource] ?? humanize(resource);
  return `${verb} ${noun}`;
}