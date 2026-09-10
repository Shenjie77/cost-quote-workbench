/** Binary templates remain in the local API database, separate from project JSON. */
import type { QuoteExcelAsset } from './excel-template-types.ts';

const ENDPOINT = 'http://127.0.0.1:3210/api/local/quote-template-assets';
export const MAX_QUOTE_TEMPLATE_BYTES = 10 * 1024 * 1024;

/** Surfaces local validation and missing-asset failures without hiding the server's remedy. */
async function assertResponse(response: Response): Promise<void> {
  if (response.ok) return;
  let message = `Excel template API returned ${response.status}.`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    message = body.error?.message || message;
  } catch {
    /* Non-JSON failures retain the HTTP status. */
  }
  throw new Error(message);
}

/** Checks asset identifiers before constructing a local URL. */
function assetEndpoint(assetId: string): string {
  if (!/^[a-f0-9]{64}$/.test(assetId))
    throw new Error('Invalid Excel template identifier.');
  return `${ENDPOINT}/${assetId}`;
}

/** Uploads the original file unchanged; parsing and persistence happen on this installation. */
export async function uploadQuoteExcelTemplate(
  file: File,
): Promise<QuoteExcelAsset> {
  if (
    !/\.xlsx$/i.test(file.name) ||
    !file.size ||
    file.size > MAX_QUOTE_TEMPLATE_BYTES
  )
    throw new Error('Select a non-empty .xlsx file of 10 MiB or smaller.');
  const response = await fetch(
    `${ENDPOINT}?fileName=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    },
  );
  await assertResponse(response);
  return ((await response.json()) as { data: QuoteExcelAsset }).data;
}

/** Reloads the sheet inventory when editing a previously saved template mapping. */
export async function inspectQuoteExcelTemplate(
  assetId: string,
): Promise<QuoteExcelAsset> {
  const response = await fetch(assetEndpoint(assetId));
  await assertResponse(response);
  return ((await response.json()) as { data: QuoteExcelAsset }).data;
}

/** Fetches one immutable workbook only when an output or local preview is requested. */
export async function loadQuoteExcelTemplate(
  assetId: string,
): Promise<Uint8Array> {
  const response = await fetch(`${assetEndpoint(assetId)}/content`);
  await assertResponse(response);
  return new Uint8Array(await response.arrayBuffer());
}
