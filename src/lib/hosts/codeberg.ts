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
  return {
    hostname: "codeberg.org",
    parseURL,
    makeRawURL: unsupported,
    toFixedVimrc: async (vimrc: VimrcFile) => unsupported(vimrc.url),
  };
};
