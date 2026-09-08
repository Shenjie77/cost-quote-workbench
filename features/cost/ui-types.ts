/** Presentation-only types for cost workspace navigation and charts. */

export type CostViewKey = 'input' | 'subcontract' | 'summary' | 'compare';

export type BreakdownItem = {
  name: string;
  nameZh: string;
  amount: number;
  mandays: number;
  share: number;
  color: string;
};
