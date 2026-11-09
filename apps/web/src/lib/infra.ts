// Absprung-Links aus Larvis zu den Diensten, die es tragen. Larvis läuft komplett auf dem
// eigenen Server: die selbst gehostete Supabase-Instanz hat kein Dashboard, auf das ein Link
// zeigen könnte, deshalb gibt es hier nur das Repo. Die URL kommt aus der Env
// (VITE_GITHUB_REPO_URL); ohne sie erscheint kein Link.

export interface InfraLink {
  key: string;
  icon: string;
  label: string;
  sub: string;
  href: string;
}

const allInfraLinks: InfraLink[] = [
  {
    key: 'github',
    icon: '🐙',
    label: 'GitHub',
    sub: 'Repo, Issues, Pipeline',
    href: import.meta.env.VITE_GITHUB_REPO_URL || '',
  },
];

export const infraLinks: InfraLink[] = allInfraLinks.filter((l) => l.href);
