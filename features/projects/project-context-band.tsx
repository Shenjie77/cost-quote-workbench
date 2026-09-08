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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-[#c9c5bb] bg-[#e9e6de] px-3 py-2 text-xs whitespace-nowrap">
      <div className="flex items-center gap-2 font-semibold text-[#173a52]">
        <Briefcase className="size-3.5" /> {project.id}
      </div>
      <div>
        <span className="text-[10px] text-muted-foreground">Client</span>
        <span className="ml-2 font-medium">{project.client}</span>
      </div>
      <div>
        <span className="text-[10px] text-muted-foreground">Currency</span>
        <span className="financial-numeral ml-2 font-medium">
          {project.currency ?? 'SGD'}
        </span>
      </div>
      <label className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">
          Proposal Number
        </span>
        {onProposalNumberChange ? (
          <Input
            aria-label="Proposal Number / Proposal 编号"
            className="h-7 w-32 bg-white/60 text-xs"
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
        <span className="text-[10px] text-muted-foreground">
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
              : 'border border-[#dfc99e] bg-[#f8f1e4] px-2 py-1'
          }
        >
          <span className="text-[10px] text-muted-foreground">
            Latest Version
          </span>
          <span className="financial-numeral ml-2 font-bold text-[#173a52]">
            {latestCostVersion}
          </span>
          {costVersion !== latestCostVersion ? (
            <span className="ml-2 text-[9px] font-semibold text-[#8d5b12]">
              Historical
            </span>
          ) : null}
        </div>
      ) : null}
      {stage ? (
        <div>
          <span className="text-[10px] text-muted-foreground">
            Current Stage
          </span>
          <span className="ml-2 font-semibold text-[#173a52]">{stage}</span>
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
        <div className="ml-auto flex items-center gap-3">{action}</div>
      )}
    </div>
  );
}
