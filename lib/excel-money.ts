/** Match the application’s upward cent rounding, including near-cent floating point noise. */
export const excelMoneyFormula = (expression: string) => {
  const cents = `((${expression})*100)`;
  return `IF(ABS(${cents}-ROUND(${cents},0))<MAX(0.0000001,2.220446049250313E-16*ABS(${cents})),ROUND(${cents},0)/100,-INT(-${cents})/100)`;
};
