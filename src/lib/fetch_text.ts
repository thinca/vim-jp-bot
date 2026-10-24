import type {Fetch} from "./types";

/**
 * Sends a GET request and reads the response body.
 * @returns The response body.
 * @throws When the response status is not successful.
 */
export const fetchText = async (fetch: Fetch, url: string, init?: {headers: Record<string, string>}): Promise<string> => {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`GET ${url} was failed:${res.status}`);
  }
  return res.text();
};
