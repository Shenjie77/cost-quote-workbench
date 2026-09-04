#!/usr/bin/env node

/** Creates the bundled starter workspace only when the local project is absent. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initialCostRows,
  initialManualCostInputs,
  initialRateSettings,
  initialTravelRows,
  initialTravelSettings,
} from '../features/cost/demo-data.ts';
import {
  initialResourceTypes,
  initialSubcontractItems,
} from '../features/master-data/demo-data.ts';
import {
  initialMaintenancePriceRecords,
  initialSupplementalCostItems,
} from '../features/master-data/domain.ts';
import {
  initialProcessSteps,
  projects,
} from '../features/projects/demo-data.ts';
import { initialPricingSettings } from '../features/quote/domain.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const databasePath = path.join(rootDirectory, 'data', 'workbench.sqlite');
const project = projects[0];
const repository = openWorkspaceRepository(databasePath);

try {
  const existing = repository.get(project.id);
  if (existing) {
    process.stdout.write(
      `${JSON.stringify({ created: false, projectId: project.id, revision: existing.revision, databasePath })}\n`,
    );
  } else {
    const saved = repository.save(
      project.id,
      {
        schemaVersion: '1.0.0',
        project: {
          id: project.id,
          name: project.name,
          client: project.client,
          currency: 'SGD',
        },
        selectedStep: 6,
        processSteps: initialProcessSteps,
        projectStatus: 'cost_review',
        activeVersion: 'V3',
        costVersions: [
          {
            code: 'V3',
            state: 'Draft',
            createdAt: '2026-09-04T01:42:00.000Z',
            sourceVersion: null,
            costRows: structuredClone(initialCostRows),
            rateSettings: structuredClone(initialRateSettings),
            travelSettings: structuredClone(initialTravelSettings),
            travelRows: structuredClone(initialTravelRows),
            travelUplift: 0,
            manualCosts: structuredClone(initialManualCostInputs),
          },
        ],
        costRows: initialCostRows,
        rateSettings: initialRateSettings,
        resourceTypes: initialResourceTypes,
        subcontractItems: initialSubcontractItems,
        supplementalCostItems: initialSupplementalCostItems,
        maintenancePriceRecords: initialMaintenancePriceRecords,
        travelSettings: initialTravelSettings,
        travelRows: initialTravelRows,
        travelUplift: 0,
        manualCosts: initialManualCostInputs,
        pricing: initialPricingSettings,
      },
      null,
    );
    process.stdout.write(
      `${JSON.stringify({ created: true, projectId: project.id, revision: saved.revision, databasePath })}\n`,
    );
  }
} finally {
  repository.close();
}
