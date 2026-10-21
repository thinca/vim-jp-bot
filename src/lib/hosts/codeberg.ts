import {URL} from "url";
import {VimrcFile} from "../types";
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
export const createCodebergHost = (): VimrcHost => {
  const unsupported = (vimrcURL: string): never => {
    throw new Error(`Not supported yet: ${vimrcURL}`);
  };
  const toFixedVimrc = async (vimrc: VimrcFile): Promise<VimrcFile> => {
    const hash = vimrc.hash;
    if (!hash) {
      return unsupported(vimrc.url);
    }
    const {origin, owner, repo, filePath} = parseCodebergURL(vimrc.url);
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
