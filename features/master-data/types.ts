/** Master-data records that do not participate directly in cost formulas yet. */

export type SubcontractItem = {
  id: string;
  code: string;
  item: string;
  bu: string;
  supplier: string;
  pricingBasis: string;
  currency: string;
  active: boolean;
};
