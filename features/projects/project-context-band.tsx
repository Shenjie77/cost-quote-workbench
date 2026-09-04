/** Current project/version context shown above project, cost, and quote views. */

import type React from 'react';
import { Briefcase } from 'lucide-react';
import { BiInline } from '@/components/workbench/bilingual-text';
import { StatusBadge } from '@/components/workbench/status-badge';

export function ContextBand({
  project = { id: 'NO-PROJECT', client: 'Not selected', currency: 'SGD' },
  stage,
  stageZh,
  costVersion = 'V3',
  latestCostVersion,
  versionStatus = 'Draft',
  action,
}: {
  project?: { id: string; client: string; currency?: string };
  stage?: string;
  stageZh?: string;
  costVersion?: string;
  latestCostVersion?: string;
  versionStatus?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-[#c9c5bb] bg-[#e9e6de] px-4 py-2.5 text-xs">
      <div className="flex items-center gap-2 font-semibold text-[#173a52]">
        <Briefcase className="size-3.5" /> {project.id}
      </div>
      <div>
        <span className="text-[10px] text-muted-foreground">
          Client <span className="text-[8px]">客户</span>
        </span>
        <span className="ml-2 font-medium">{project.client}</span>
      </div>
      <div>
        <span className="text-[10px] text-muted-foreground">
          Currency <span className="text-[8px]">币种</span>
        </span>
        <span className="financial-numeral ml-2 font-medium">
          {project.currency ?? 'SGD'}
        </span>
      </div>
      <div>
        <span className="text-[10px] text-muted-foreground">
          Current Version <span className="text-[8px]">当前版本</span>
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
            Latest Version <span className="text-[8px]">最新版本</span>
          </span>
          <span className="financial-numeral ml-2 font-bold text-[#173a52]">
            {latestCostVersion}
          </span>
          {costVersion !== latestCostVersion ? (
            <span className="ml-2 text-[9px] font-semibold text-[#8d5b12]">
              Historical view / 当前为历史版本
            </span>
          ) : null}
        </div>
      ) : null}
      {stage ? (
        <div>
          <span className="text-[10px] text-muted-foreground">
            Current Stage <span className="text-[8px]">当前阶段</span>
          </span>
          <span className="ml-2 font-semibold text-[#173a52]">{stage}</span>
          <span className="ml-1 text-[9px] text-muted-foreground">
            {stageZh}
          </span>
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
          <BiInline
            en={versionStatus}
            zh={
              versionStatus === 'Confirmed'
                ? '已确认'
                : versionStatus === 'Suspended'
                  ? '已暂停'
                  : '草稿'
            }
          />
        </StatusBadge>
      )}
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-[10px] text-muted-foreground xl:inline">
          Live calculation from selected version{' '}
          <span className="text-[8px]">基于当前版本实时计算</span>
        </span>
        {action}
      </div>
    </div>
  );
}
