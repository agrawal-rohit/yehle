/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from 'react';

import lightSrc from './light-logo.svg';
import darkSrc from './dark-logo.svg';

type Props = Readonly<{
  className?: string;
  style?: CSSProperties;
}>;

export default function Logo({ className, style }: Props) {
  const imgClassName = className ?? 'h-6 w-auto';

  const lightUrl =
    typeof lightSrc === 'string' ? lightSrc : (lightSrc as { src?: string }).src;
  const darkUrl =
    typeof darkSrc === 'string' ? darkSrc : (darkSrc as { src?: string }).src;

  return (
    <>
      <img
        src={lightUrl}
        alt="Yehle"
        style={style}
        className={`${imgClassName} block dark:hidden`}
        draggable={false}
      />
      <img
        src={darkUrl}
        alt="Yehle"
        style={style}
        className={`${imgClassName} hidden dark:block`}
        draggable={false}
      />
    </>
  );
}