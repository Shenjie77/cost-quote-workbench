/** One transport origin for every live module. Existing local installations retain port 3210. */
export function localApiBase(origin = 'http://127.0.0.1:3210'): string {
  const url = new URL(origin);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new TypeError(
      'The workbench API must use a same-device HTTP origin.',
    );
  return `${url.origin}/api/local`;
}
const env = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;
export const LOCAL_API_BASE = localApiBase(env?.VITE_WORKBENCH_API_ORIGIN);
