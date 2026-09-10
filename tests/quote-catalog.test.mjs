/** Regression coverage for customer isolation, copy semantics and catalog reuse. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applicableTemplates,
  matchesClient,
  referenceAssumptions,
  copyQuoteCatalog,
} from '../features/quote/catalog-domain.ts';
import {
  createAssumptionLibrary,
  initialQuoteAssumptions,
  initialQuoteTemplates,
} from '../features/quote/types.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { validateGlobalMasterDataRows } from '../server/global-master-data.mjs';

test('English-only templates and legacy translation snapshots both remain persistable', () => {
  const workspace = createBlankWorkspace(
    projectRecord('P-TEMPLATE-EN', 'Project', 'Customer'),
  );
  assert.equal(workspace.quoteTemplates[0].documentTitleZh, undefined);
  assert.doesNotThrow(() =>
    validateGlobalMasterDataRows('quote-templates', workspace.quoteTemplates),
  );
  const legacy = {
    ...workspace.quoteTemplates[0],
    nameZh: '原模板名称',
    documentTitleZh: '原标题',
    paymentTermsZh: '原付款条件',
  };
  workspace.quoteHistory = [
    {
      id: 'legacy-output',
      quoteNumber: 'Q-OLD',
      generatedAt: '2026-09-09T01:00:00.000Z',
      costVersion: 'V1',
      templateId: legacy.id,
      status: 'Draft',
      costAmount: 100,
      quoteBeforeTax: 125,
      gstAmount: 0,
      quoteAfterTax: 125,
      grossMarginPercent: 20,
      note: '',
      templateSnapshot: legacy,
      assumptionSnapshots: [],
    },
  ];
  const repository = openWorkspaceRepository(':memory:');
  try {
    const saved = repository.save(workspace.project.id, workspace, null);
    assert.equal(saved.workspace.quoteTemplates[0].documentTitleZh, undefined);
    assert.deepEqual(saved.workspace.quoteHistory[0].templateSnapshot, legacy);
  } finally {
    repository.close();
  }
});

test('legacy library names trim whitespace without modifying quoted body text', () => {
  const text = ' '.repeat(100) + 'Valid existing clause';
  const library = createAssumptionLibrary([
    { id: 'legacy', text, textZh: '', included: true },
  ]);
  assert.equal(library[0].name, 'Valid existing clause');
  assert.equal(library[0].text, text);
});

test('customer matching is exact, normalized and never executes regular expressions', () => {
  assert.equal(matchesClient(' Acme ', 'ACME'), true);
  assert.equal(matchesClient('*', '任意客户'), true);
  assert.equal(matchesClient('客户甲', '客户乙'), false);
  assert.equal(matchesClient('Acme', 'Acme Other'), false);
  assert.equal(matchesClient('.*', 'Acme'), false);
  const common = initialQuoteTemplates[0];
  const customer = { ...common, id: 'customer', clientPattern: 'Acme' };
  assert.deepEqual(
    applicableTemplates(
      [
        common,
        { ...customer, id: 'inactive', active: false },
        customer,
        { ...customer, id: 'other', clientPattern: 'Other' },
      ],
      'ACME',
    ).map((item) => item.id),
    ['customer', common.id],
  );
});

test('library references preserve edits and exclusions and are idempotent', () => {
  const library = createAssumptionLibrary(initialQuoteAssumptions);
  const first = referenceAssumptions(
    [],
    library,
    [library[0].id, library[0].id],
    'Client',
    () => 'copy-1',
  );
  assert.equal(first.length, 1);
  assert.equal(first[0].sourceAssumptionId, library[0].id);
  first[0].text = 'Project-specific edit';
  first[0].included = false;
  library[0].text = 'Updated master text';
  assert.deepEqual(
    referenceAssumptions(first, library, [library[0].id], 'Client'),
    first,
  );
  assert.equal(
    referenceAssumptions(
      initialQuoteAssumptions,
      library,
      [library[1].id],
      'Client',
    ).length,
    initialQuoteAssumptions.length,
  );
  library[1].active = false;
  library[2].clientPattern = 'Other';
  assert.deepEqual(
    referenceAssumptions(
      [],
      library,
      [library[1].id, library[2].id, 'missing'],
      'Client',
    ),
    [],
  );
});

test('cross-project catalog copies remap IDs and detach linked template defaults', () => {
  const library = createAssumptionLibrary(initialQuoteAssumptions);
  const templates = [
    { ...initialQuoteTemplates[0], defaultAssumptionIds: [library[0].id] },
  ];
  const copied = copyQuoteCatalog(library, templates);
  assert.notEqual(copied.library[0].id, library[0].id);
  assert.notEqual(copied.templates[0].id, templates[0].id);
  assert.deepEqual(copied.templates[0].defaultAssumptionIds, [
    copied.library[0].id,
  ]);
  copied.library[0].text = 'Changed';
  assert.notEqual(library[0].text, 'Changed');
});
