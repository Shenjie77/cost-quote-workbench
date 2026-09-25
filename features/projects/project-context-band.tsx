/** One compact project identity strip shared by cost, quotation and workflow pages. */
import type React from 'react';
import { useState } from 'react';
import { Briefcase, FolderOpen, Pencil } from 'lucide-react';
import { StatusBadge } from '@/components/workbench/status-badge';
import { Button } from '@/components/ui/button';
import { ReferenceLink } from './project-reference-link';
import { openArchiveFolder } from './project-files';

export type ProjectContextActions = {
  companyUrl?: string;
  cpqUrl?: string;
  onEdit?: () => void;
  editDisabled?: boolean;
};

/** Show project references in a fixed order; folder requests resolve the saved path on the API host. */
export function ContextBand({
  project = { id: '', name: 'No project', client: '' },
  stage,
  costVersion = '—',
  latestCostVersion,
  versionStatus = 'Draft',
  proposalNumber = '',
  versionLabel = 'Current Version',
  companyUrl,
  cpqUrl,
  onEdit,
  editDisabled = false,
  action,
}: ProjectContextActions & {
  project?: { id: string; name?: string; client: string; currency?: string };
  stage?: string;
  stageZh?: string;
  costVersion?: string;
  latestCostVersion?: string;
  versionStatus?: string;
  proposalNumber?: string;
  /** Kept for older embedded consumers; project references are now edited together using Edit. */
  onProposalNumberChange?: (value: string) => void;
  versionLabel?: 'Current Version' | 'Current Round';
  action?: React.ReactNode;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  /** Prevent duplicate launches and expose actionable API errors without navigating away. */
  const openFolder = async () => {
    if (opening || !project.id) return;
    setOpening(true);
    setError('');
    try {
      await openArchiveFolder(project.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to open project folder.',
      );
    } finally {
      setOpening(false);
    }
  };
  const historical = latestCostVersion && latestCostVersion !== costVersion;
  return (
    <section aria-label="Project information" className="wb-panel min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
        <div
          className="flex min-w-0 max-w-full items-center gap-1.5 font-semibold text-primary"
          title={project.name}
        >
          <Briefcase className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="break-words">{project.name || 'Project'}</span>
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-muted-foreground">
            Proposal Number
          </span>
          <span className="break-all font-medium">
            {proposalNumber || 'Not set'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ReferenceLink label="iSales" value={companyUrl} />
          <ReferenceLink label="CPQ" value={cpqUrl} />
          <Button
            variant="ghost"
            size="sm"
            onClick={openFolder}
            disabled={opening || !project.id}
            aria-label="Open project folder"
          >
            <FolderOpen className="size-3.5" aria-hidden="true" />
            {opening ? 'Opening…' : 'Folder'}
          </Button>
        </div>
        <div
          className="flex items-baseline gap-2"
          title={
            historical ? `Latest Version: ${latestCostVersion}` : undefined
          }
        >
          <span className="text-muted-foreground">{versionLabel}</span>
          <span className="financial-numeral font-semibold">{costVersion}</span>
          {historical && <span className="text-amber-700">Historical</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Status</span>
          <StatusBadge
            tone={
              versionStatus === 'Confirmed' || versionStatus === 'Completed'
                ? 'green'
                : versionStatus === 'Suspended' || versionStatus === 'On Hold'
                  ? 'gray'
                  : 'amber'
            }
          >
            {stage || versionStatus}
          </StatusBadge>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {action}
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            disabled={editDisabled || !onEdit}
            aria-label="Edit project information"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="border-t px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
