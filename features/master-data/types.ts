/** Master-data records that do not participate directly in cost formulas yet. */

export type SubcontractItem = {
  id: string;
  code: string;
  item: string;
  bu: string;
  /** Legacy reference retained on existing records, no longer required for pricing. */
  supplier?: string;
  /** Legacy descriptive metadata, retained only for backward compatibility. */
  pricingBasis?: string;
  /** Missing legacy values or explicit null mean unset; a zero price means free. */
  unit?: string | null;
  unitPrice?: number | null;
  currency: string;
  active: boolean;
};
