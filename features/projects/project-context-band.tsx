/** Current project/version context shown above project, cost, and quote views. */

import type React from 'react';
import { Briefcase } from 'lucide-react';
import { StatusBadge } from '@/components/workbench/status-badge';
import { Input } from '@/components/ui/input';

export function ContextBand({
  project = { id: 'NO-PROJECT', client: 'Not selected', currency: 'SGD' },
  stage,
  costVersion = 'V3',
  latestCostVersion,
  versionStatus = 'Draft',
  proposalNumber = '',
  onProposalNumberChange,
  action,
}: {
  project?: { id: string; client: string; currency?: string };
  stage?: string;
  stageZh?: string;
  costVersion?: string;
  latestCostVersion?: string;
  versionStatus?: string;
  proposalNumber?: string;
  onProposalNumberChange?: (value: string) => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="wb-panel flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 text-xs">
      <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 font-semibold text-[#183c51]">
        <Briefcase className="size-3.5" /> {project.id}
      </div>
      <div>
        <span className="text-[11px] text-muted-foreground">Client</span>
        <span className="ml-2 break-words font-medium">{project.client}</span>
      </div>
      <div>
        <span className="text-[11px] text-muted-foreground">Currency</span>
        <span className="financial-numeral ml-2 font-medium">
          {project.currency ?? 'SGD'}
        </span>
      </div>
      <label className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          Proposal Number
        </span>
        {onProposalNumberChange ? (
          <Input
            aria-label="Proposal Number / Proposal 编号"
            className="h-9 w-40 bg-white text-xs"
            value={proposalNumber}
            onChange={(event) => onProposalNumberChange(event.target.value)}
            placeholder="Not set"
            maxLength={2000}
          />
        ) : (
          <span className="font-medium">{proposalNumber || 'Not set'}</span>
        )}
      </label>
      <div>
        <span className="text-[11px] text-muted-foreground">
          Current Version
        </span>
        <span className="financial-numeral ml-2 font-semibold">
          {costVersion}
        </span>
      </div>
      {latestCostVersion ? (
        <div
          className={
            costVersion === latestCostVersion
              ? ''
              : 'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2'
          }
        >
          <span className="text-[11px] text-muted-foreground">
            Latest Version
          </span>
          <span className="financial-numeral ml-2 font-bold text-[#183c51]">
            {latestCostVersion}
          </span>
          {costVersion !== latestCostVersion ? (
            <span className="ml-2 text-[11px] font-semibold text-[#8d5b12]">
              Historical
            </span>
          ) : null}
        </div>
      ) : null}
      {stage ? (
        <div>
          <span className="text-[11px] text-muted-foreground">
            Current Stage
          </span>
          <span className="ml-2 font-semibold text-[#183c51]">{stage}</span>
        </div>
      ) : (
        <StatusBadge
          tone={
            versionStatus === 'Confirmed'
              ? 'green'
              : versionStatus === 'Suspended'
                ? 'gray'
                : 'amber'
          }
        >
          {versionStatus}
        </StatusBadge>
      )}
      {action && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {action}
        </div>
      )}
    </div>
  );
}
