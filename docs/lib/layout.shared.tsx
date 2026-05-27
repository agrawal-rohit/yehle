import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Logo from '@/components/logo';

export const gitConfig = {
  user: 'agrawal-rohit',
  repo: 'yehle',
  branch: 'main',
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
