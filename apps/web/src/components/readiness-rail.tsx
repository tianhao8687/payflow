import {
  CodeIcon,
  ContainerIcon,
  DatabaseIcon,
  ServerIcon,
} from './system-icons';

const readinessItems = [
  {
    title: 'Web',
    detail: 'Next.js catalog + admin console',
    icon: CodeIcon,
  },
  {
    title: 'API',
    detail: 'NestJS payment domains + RBAC',
    icon: ServerIcon,
  },
  {
    title: 'Data',
    detail: 'Orders + payments + refunds',
    icon: DatabaseIcon,
  },
  {
    title: 'Delivery',
    detail: 'Provider adapter + failure gates',
    icon: ContainerIcon,
  },
] as const;

export function ReadinessRail() {
  return (
    <ul className="mt-8 grid list-none gap-7 p-0 sm:grid-cols-2 sm:gap-0 lg:grid-cols-4">
      {readinessItems.map((item, index) => {
        const Icon = item.icon;

        return (
          <li
            className={`flex min-w-0 items-center gap-4 sm:min-h-[104px] sm:px-6 lg:px-8 ${
              index === 0 ? 'sm:pl-0' : ''
            } ${index % 2 === 1 ? 'sm:border-l sm:border-[#cdd2d9]' : ''} ${
              index > 0 ? 'lg:border-l lg:border-[#cdd2d9]' : ''
            }`}
            key={item.title}
          >
            <Icon className="h-12 w-12 shrink-0 text-[#0757ff] sm:h-14 sm:w-14" />
            <div className="min-w-0">
              <h3 className="font-mono text-base font-bold tracking-[-0.04em] sm:text-lg">
                {item.title}
              </h3>
              <p className="mt-2 font-mono text-[0.78rem] leading-5 tracking-[-0.025em] text-[#5d626c] sm:text-[0.82rem]">
                {item.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
