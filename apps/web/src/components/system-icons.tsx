import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const iconProps = {
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.8,
  viewBox: '0 0 32 32',
  xmlns: 'http://www.w3.org/2000/svg',
};

export function CodeIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="m11.5 8-7 8 7 8M20.5 8l7 8-7 8M18.5 5l-5 22" />
    </svg>
  );
}

export function ServerIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <rect height="6" rx="1.5" width="22" x="5" y="5" />
      <rect height="6" rx="1.5" width="22" x="5" y="13" />
      <rect height="6" rx="1.5" width="22" x="5" y="21" />
      <path d="M9 8h.01M9 16h.01M9 24h.01" strokeWidth="2.6" />
    </svg>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <ellipse cx="16" cy="7" rx="10" ry="4" />
      <path d="M6 7v9c0 2.2 4.5 4 10 4s10-1.8 10-4V7" />
      <path d="M6 16v9c0 2.2 4.5 4 10 4s10-1.8 10-4v-9" />
    </svg>
  );
}

export function GatewayIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="m16 4 10 5.8v12.4L16 28 6 22.2V9.8L16 4Z" />
      <path d="m6 9.8 10 5.8 10-5.8M16 15.6V28M20 18v6l3-1.8" />
    </svg>
  );
}

export function ContainerIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="m16 3.8 11 6.4v12.6L16 29.2 5 22.8V10.2L16 3.8Z" />
      <path d="m5 10.2 11 6.4 11-6.4M16 16.6v12.6M21 13.7v7.8" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="m9 16.5 4.5 4.5L23 11" strokeWidth="2.6" />
    </svg>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M7 16h18M19 9l7 7-7 7" strokeWidth="2" />
    </svg>
  );
}
