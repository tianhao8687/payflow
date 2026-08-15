'use client';

import { useEffect, useState } from 'react';

import {
  ArrowIcon,
  CheckIcon,
  CodeIcon,
  ContainerIcon,
  DatabaseIcon,
  GatewayIcon,
  ServerIcon,
} from './system-icons';

type ApiState = 'checking' | 'running' | 'unavailable';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export function SystemFlow() {
  const [apiState, setApiState] = useState<ApiState>('checking');

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch(`${apiBaseUrl}/health`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        setApiState(response.ok ? 'running' : 'unavailable');
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setApiState('unavailable');
        }
      }
    }

    void checkHealth();
    return () => controller.abort();
  }, []);

  const infrastructureReady = apiState === 'running';

  return (
    <div
      className="relative grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-7 lg:grid-cols-6 lg:gap-4"
      aria-label="PayFlow Stage 11 system flow"
    >
      <FlowNode
        icon={<CodeIcon />}
        label="Next.js web"
        status="running"
        statusTone="success"
      />
      <FlowNode
        connector
        icon={<ServerIcon />}
        label="NestJS API"
        status={apiState}
        statusTone={infrastructureReady ? 'success' : 'pending'}
      />
      <FlowNode
        connector
        icon={<DatabaseIcon />}
        label="PostgreSQL"
        status={infrastructureReady ? 'ready' : apiState}
        statusTone={infrastructureReady ? 'success' : 'pending'}
      />
      <FlowNode
        connector
        icon={<DatabaseIcon />}
        label="Redis + BullMQ"
        status={infrastructureReady ? 'ready' : apiState}
        statusTone={infrastructureReady ? 'success' : 'pending'}
      />
      <FlowNode
        connector
        icon={<ContainerIcon />}
        label="Webhook worker"
        status={infrastructureReady ? 'processing' : apiState}
        statusTone={infrastructureReady ? 'success' : 'pending'}
      />
      <FlowNode
        connector
        icon={<GatewayIcon />}
        label="Stripe + PayPal"
        status="sandbox providers"
        statusTone="success"
      />
    </div>
  );
}

interface FlowNodeProps {
  connector?: boolean;
  future?: boolean;
  icon: React.ReactNode;
  label: string;
  status: string;
  statusTone: 'success' | 'pending' | 'future';
}

function FlowNode({
  connector = false,
  future = false,
  icon,
  label,
  status,
  statusTone,
}: FlowNodeProps) {
  const successful = statusTone === 'success';

  return (
    <div className="relative flex min-w-0 flex-col items-center text-center">
      {connector ? (
        <div
          className={`absolute top-[53px] right-[calc(50%+58px)] hidden h-px w-[calc(100%-84px)] lg:block ${
            future
              ? 'border-t-2 border-dashed border-[#0757ff]'
              : 'bg-[#0757ff]'
          }`}
          aria-hidden="true"
        >
          <ArrowIcon className="absolute -right-[11px] -top-[12px] h-6 w-6 bg-white text-[#0757ff]" />
        </div>
      ) : null}

      <div
        className={`flex h-[106px] w-[106px] items-center justify-center rounded-[12px] border-2 text-[#0757ff] sm:h-[116px] sm:w-[116px] ${
          future ? 'border-dashed border-[#0757ff]' : 'border-[#0757ff]'
        }`}
      >
        <span className="block h-14 w-14 sm:h-[62px] sm:w-[62px]">{icon}</span>
      </div>

      <p className="mt-5 truncate font-mono text-[0.83rem] font-semibold tracking-[-0.045em] text-[#191c22] sm:text-[0.9rem] lg:w-full">
        {label}
      </p>

      <div
        className={`mt-5 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
          successful
            ? 'border-[#08ae8c] bg-[#08ae8c] text-white'
            : 'border-[#0757ff] bg-white text-[#0757ff]'
        }`}
      >
        {successful ? (
          <CheckIcon className="h-5 w-5" />
        ) : (
          <ArrowIcon className="h-5 w-5" />
        )}
      </div>
      <p
        aria-live={label === 'NestJS API' ? 'polite' : undefined}
        className={`mt-3 font-mono text-[0.8rem] tracking-[-0.025em] sm:text-[0.92rem] ${
          successful ? 'text-[#079b7e]' : 'text-[#0757ff]'
        }`}
      >
        {status}
      </p>
    </div>
  );
}
