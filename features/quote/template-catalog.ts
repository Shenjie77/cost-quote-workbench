import type { AssumptionDefinition, QuoteTemplate } from './types';

export type QuoteTemplateCatalog = {
  templates: QuoteTemplate[];
  assumptions: AssumptionDefinition[];
};

/** Read saved catalogs without replacing the project's applied commercial snapshot. */
export async function loadQuoteTemplateCatalog(): Promise<QuoteTemplateCatalog> {
  const { getGlobalMasterData } = await import('../master-data/global-client');
  const [templates, assumptions] = await Promise.all([
    getGlobalMasterData<QuoteTemplate>('quote-templates'),
    getGlobalMasterData<AssumptionDefinition>('assumptions'),
  ]);
  if (templates.conflicts.length || assumptions.conflicts.length)
    throw new Error(
      'Resolve quotation template and assumption conflicts in Master Data, then refresh templates.',
    );
  return { templates: templates.items, assumptions: assumptions.items };
}
