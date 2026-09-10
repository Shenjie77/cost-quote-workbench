import type { WorkbenchWorkspace } from '../workbench/workspace-types';
import { emptySsr } from '../ssr/domain.ts';

export type ProjectDetails = {
  name: string;
  client: string;
  proposalNumber: string;
  companyUrl: string;
  cpqUrl: string;
  scopeBrief: string;
  technicalBasis: string;
};

export function projectDetails(workspace: WorkbenchWorkspace): ProjectDetails {
  return {
    name: workspace.project.name,
    client: workspace.project.client,
    proposalNumber: workspace.ssr?.proposalNumber || '',
    companyUrl: workspace.ssr?.companyUrl || '',
    cpqUrl: workspace.ssr?.cpqUrl || '',
    scopeBrief: workspace.ssr?.scopeBrief || '',
    technicalBasis: workspace.ssr?.technicalBasis || '',
  };
}

/** Compare only editable information; unrelated cost autosaves may advance revision. */
export function applyProjectDetails(
  workspace: WorkbenchWorkspace,
  details: ProjectDetails,
  baseline: ProjectDetails,
): WorkbenchWorkspace {
  if (JSON.stringify(projectDetails(workspace)) !== JSON.stringify(baseline))
    throw new Error(
      'Project information changed. Reopen Edit to load the latest values.',
    );
  const name = details.name.trim(),
    client = details.client.trim();
  if (!name || !client || name.length > 200 || client.length > 200)
    throw new Error(
      'Project Name and Client are required (up to 200 characters).',
    );
  for (const [label, value] of [
    ['iSales Link', details.companyUrl],
    ['CPQ Link', details.cpqUrl],
  ]) {
    if (!value.trim()) continue;
    try {
      if (!['http:', 'https:'].includes(new URL(value.trim()).protocol))
        throw new Error();
    } catch {
      throw new Error(`${label} must be a valid http or https URL.`);
    }
  }
  const next = structuredClone(workspace);
  next.project = { ...next.project, name, client };
  next.ssr = {
    ...(next.ssr || emptySsr()),
    proposalNumber: details.proposalNumber.trim(),
    companyUrl: details.companyUrl.trim(),
    cpqUrl: details.cpqUrl.trim(),
    scopeBrief: details.scopeBrief.trim(),
    technicalBasis: details.technicalBasis.trim(),
  };
  return next;
}
