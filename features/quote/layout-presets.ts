import type {
  QuoteExcelAsset,
  QuoteExcelTemplate,
} from './excel-template-types.ts';

export type SavedQuoteLayout = {
  id: string;
  name: string;
  revision: number;
  mapping: Omit<QuoteExcelTemplate, 'assetId' | 'fileName'>;
};
/** A layout owns configuration, never another customer's workbook/logo bytes. */
export function reusableLayout(
  mapping: QuoteExcelTemplate,
): SavedQuoteLayout['mapping'] {
  const {
    assetId: _asset,
    fileName: _file,
    ...layout
  } = structuredClone(mapping);
  return layout;
}
export function applySavedLayout(
  layout: SavedQuoteLayout['mapping'],
  asset: QuoteExcelAsset,
  currentSheet?: string,
): QuoteExcelTemplate {
  const names = asset.sheets.map((sheet) => sheet.name);
  return {
    ...structuredClone(layout),
    assetId: asset.assetId,
    fileName: asset.fileName,
    sheetName: names.includes(layout.sheetName)
      ? layout.sheetName
      : names.includes(currentSheet ?? '')
        ? currentSheet!
        : (names[0] ?? ''),
  };
}
