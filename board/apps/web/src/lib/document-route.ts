export const documentHash = (ref:string) => `#/docs/${encodeURIComponent(ref)}`
export function parseDocumentHash(hash:string):string|null {
  const match = hash.match(/^#\/docs\/([^/?#]+)$/)
  if (!match) return null
  try {return decodeURIComponent(match[1]) || null} catch {return null}
}
