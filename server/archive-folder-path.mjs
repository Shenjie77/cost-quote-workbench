/** Parse pasted folder paths without interpreting shell commands or changing files. */
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const quotePairs = new Map([
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
]);
const shellEscapedCharacters = new Set(' ()[]{}&;\'"#!?$*<>|`\\');

/**
 * Accept native absolute paths and common Finder/Terminal clipboard forms.
 * Conversion is lexical only: the archive store still checks directory identity,
 * nesting, existing destinations and permissions before copying any document.
 */
export function normalizeArchiveFolderPath(
  input,
  { platform = process.platform, homeDirectory = homedir() } = {},
) {
  if (typeof input !== 'string' || !input.trim())
    throw new TypeError('Enter a full folder path.');
  let folder = input.trim();
  const closingQuote = quotePairs.get(folder[0]);
  const quoted = Boolean(closingQuote);
  if (quoted) {
    if (!folder.endsWith(closingQuote) || folder.length < 2)
      throw new TypeError('The folder path has an unmatched quotation mark.');
    folder = folder.slice(1, -1);
  }

  const windows = platform === 'win32';
  const nativePath = windows ? path.win32 : path.posix;
  // File URLs must be local filesystem URLs; reject query/fragment components
  // rather than silently moving documents to a different decoded destination.
  if (/^file:/i.test(folder)) {
    try {
      const url = new URL(folder);
      if (url.search || url.hash) throw new TypeError('Unexpected URL suffix.');
      if (!windows && /^\/[a-z]:\//i.test(url.pathname))
        throw new TypeError(
          'A Windows file URL cannot identify a local folder.',
        );
      folder = fileURLToPath(url, { windows });
    } catch {
      throw new TypeError(
        'The file URL is not a valid folder on this computer. Use its local filesystem path.',
      );
    }
  } else if (/^[a-z][a-z\d+.-]*:\/\//i.test(folder)) {
    throw new TypeError(
      'Use a folder path on the computer running the workbench. Mount network shares first; web and share URLs cannot be used.',
    );
  } else {
    if (!windows && (/^[a-z]:[\\/]/i.test(folder) || folder.startsWith('\\\\')))
      throw new TypeError(
        'This workbench runs on macOS or Linux and cannot use a Windows drive or UNC path. Use the folder mounted on this computer, such as /Volumes/Share/Project.',
      );
    // Terminal escapes are removed only from unquoted POSIX paths. Quoted paths
    // and Windows separators remain literal; no variables or commands expand.
    if (!windows && !quoted)
      folder = folder.replace(/\\(.)/gu, (escaped, character) =>
        shellEscapedCharacters.has(character) ? character : escaped,
      );
    if (
      folder === '~' ||
      folder.startsWith('~/') ||
      (windows && folder.startsWith('~\\'))
    )
      folder = nativePath.join(homeDirectory, folder.slice(2));
  }

  if (
    !nativePath.isAbsolute(folder) ||
    (windows && !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(folder))
  )
    throw new TypeError(
      `Enter a full absolute folder path on the computer running the workbench, such as ${windows ? 'C:\\Projects\\Project' : '/Users/name/Projects/Project'}.`,
    );
  if (
    folder.length > 4096 ||
    Array.from(folder).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    throw new TypeError(
      'The folder path must be at most 4096 characters and contain no control characters.',
    );
  return nativePath.normalize(folder);
}
