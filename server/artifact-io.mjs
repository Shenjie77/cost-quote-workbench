/** Exclusive artifact writes shared by new CLI exporters. */
import { mkdir, writeFile, link, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export async function writeXlsxArtifact(output, bytes, overwrite = false) {
  const filePath = path.resolve(output);
  if (path.extname(filePath).toLowerCase() !== '.xlsx')
    throw new TypeError('Output must end with .xlsx');
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.workbench-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    if (overwrite) await rename(temporary, filePath);
    else await link(temporary, filePath);
  } finally {
    await unlink(temporary).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
  return {
    path: filePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
