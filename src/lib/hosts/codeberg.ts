import {URL} from "url";
import type {Fetch, VimrcFile} from "../types";
import type {VimrcHost, VimrcURLInfo} from "./types";

const parseCodebergURL = (urlString: string) => {
  const url = new URL(urlString);
  const [owner, repo, , refKind, ref, ...filePath] = url.pathname.slice(1).split("/");
  return {origin: url.origin, owner, repo, refKind, ref, filePath: filePath.join("/")};
};

const parseURL = (url: string): VimrcURLInfo => {
  const {origin, owner, refKind, ref, filePath} = parseCodebergURL(url);
  return {
    vimrc: {
      url,
      hash: refKind === "commit" ? ref : null,
      name: filePath.split("/").at(-1) ?? "",
    },
    author: {
      name: owner,
      url: `${origin}/${owner}`,
    },
  };
};

/**
 * Creates the codeberg.org host.
 */
export const createCodebergHost = ({fetch}: {fetch: Fetch}): VimrcHost => {
  const unsupported = (vimrcURL: string): never => {
    throw new Error(`Not supported yet: ${vimrcURL}`);
  };
  // stat, verification, and files are turned off because the API computes them for every listed commit.
  const lastCommitHash = async (origin: string, owner: string, repo: string): Promise<string> => {
    const apiURL = `${origin}/api/v1/repos/${owner}/${repo}/commits?limit=1&stat=false&verification=false&files=false`;
    const res = await fetch(apiURL);
    if (!res.ok) {
      throw new Error(`GET ${apiURL} was failed:${res.status}`);
    }
    const [commit] = JSON.parse(await res.text()) as {sha: string}[];
    return commit.sha;
  };
  const toFixedVimrc = async (vimrc: VimrcFile): Promise<VimrcFile> => {
    const {origin, owner, repo, filePath} = parseCodebergURL(vimrc.url);
    const hash = vimrc.hash || await lastCommitHash(origin, owner, repo);
    return {
      name: vimrc.name,
      url: `${origin}/${owner}/${repo}/src/commit/${hash}/${filePath}`,
      raw_url: `${origin}/${owner}/${repo}/raw/commit/${hash}/${filePath}`,
      hash,
    };
  };
  return {
    hostname: "codeberg.org",
    parseURL,
    makeRawURL: unsupported,
    toFixedVimrc,
  };
};
