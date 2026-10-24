import {URL} from "url";
import type {Fetch, VimrcFile} from "../types";
import {fetchText} from "../fetch_text";
import type {VimrcHost, VimrcURLInfo} from "./types";

const makeRawURL = (urlString: string): string => {
  const url = new URL(urlString);
  url.hostname = "raw.githubusercontent.com";
  const pathnames = url.pathname.split("/");
  pathnames.splice(3, 1);
  url.pathname = pathnames.join("/");
  return url.toString();
};

const parseURL = (url: string): VimrcURLInfo => {
  const paths = url.split("/");
  const hash = /^[0-9a-f]{40}$/.test(paths[6]) ? paths[6] : null;
  return {
    vimrc: {
      url,
      hash,
      name: paths[paths.length - 1],
    },
    author: {
      name: paths[3],
      url: paths.slice(0, 4).join("/"),
    },
  };
};

/**
 * Creates the GitHub host.
 * The latest commit hash is cached per repository for the lifetime of the returned host.
 * @param token GitHub API token, which raises the rate limit of the API.
 */
export const createGitHubHost = ({fetch, token}: {fetch: Fetch, token?: string}): VimrcHost => {
  const lastCommitHash = (() => {
    // XXX: Should cache expire?
    const hashes = new Map<string, string>();
    return async (url: string): Promise<string> => {
      const [, place] = url.match(/https:\/\/github\.com\/([^/]+\/[^/]+)/) || [];
      // XXX Should `hashes` lock? How?
      const cached = hashes.get(place);
      if (cached) {
        return cached;
      }
      const apiURL = `https://api.github.com/repos/${place}/commits/HEAD`;
      const headers: Record<string, string> = {"Accept": "application/vnd.github.VERSION.sha"};
      if (token) {
        headers["Authorization"] = `token ${token}`;
      }
      const version = await fetchText(fetch, apiURL, {headers});
      hashes.set(place, version);
      return version;
    };
  })();

  const toFixedVimrc = async (vimrc: VimrcFile): Promise<VimrcFile> => {
    const hash = vimrc.hash || await lastCommitHash(vimrc.url);
    vimrc.hash = hash;
    const url = vimrc.url.replace(/blob\/\w+\//, `blob/${hash}/`);
    const raw_url = vimrc.url
      .replace(/https:\/\/github/, "https://raw.githubusercontent")
      .replace(/blob\/[^/]+\//, `${hash}/`);
    return {name: vimrc.name, url, raw_url, hash};
  };

  return {hostname: "github.com", parseURL, makeRawURL, toFixedVimrc};
};
