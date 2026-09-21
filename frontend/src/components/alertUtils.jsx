import { DuplicateIcon, GhostIcon, LimitIcon, SplitIcon, UsersIcon } from './icons';

export function getAlertPresentation(title) {
  if (title.includes('Duplicate')) return { Icon: DuplicateIcon, bg: '#fdecec', color: '#dc2626' };
  if (title.includes('Approval')) return { Icon: LimitIcon, bg: '#fdf1e2', color: '#ea8c1e' };
  if (title.includes('Splitting')) return { Icon: SplitIcon, bg: '#fdf1e2', color: '#ea8c1e' };
  if (title.includes('Ghost')) return { Icon: GhostIcon, bg: '#fdecec', color: '#dc2626' };
  if (title.includes('Segregation')) return { Icon: UsersIcon, bg: '#fdf1e2', color: '#ea8c1e' };
  return { Icon: LimitIcon, bg: '#fdf1e2', color: '#ea8c1e' };
}
