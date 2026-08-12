import type { SVGProps } from 'react';

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M24 3.5 42 14v20L24 44.5 6 34V14L24 3.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
      <path
        d="m14 33.2 10 5.8 10-5.8V19.1L24 13.3l-10 5.8v14.1Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
      <path
        d="m14 19.1 10 5.8 10-5.8M24 24.9V39"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}
