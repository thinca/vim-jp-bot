import {URL} from "url";
import type {Fetch, VimrcFile} from "../types";
import {createGitHubHost} from "./github";
import {createCodebergHost} from "./codeberg";
import type {VimrcHost, VimrcURLInfo} from "./types";

/**
 * Creates the operations on vimrc URLs, each dispatched to the host the URL belongs to.
 * Every operation throws when the URL is on an unsupported host.
 * @param token GitHub API token.
 */
export const createVimrcHosts = ({fetch, token}: {fetch: Fetch, token?: string}) => {
  const hosts: VimrcHost[] = [
    createGitHubHost({fetch, token}),
    createCodebergHost({fetch}),
  ];
  const findHost = (url: string): VimrcHost => {
    const {hostname} = new URL(url);
    const host = hosts.find((h) => h.hostname === hostname);
    if (!host) {
      throw new Error(`Unsupported host: ${hostname}`);
    }
    return host;
  };

  return {
    parseVimrcURL: (url: string): VimrcURLInfo => findHost(url).parseURL(url),
    makeRawURL: (url: string): string => findHost(url).makeRawURL(url),
    toFixedVimrc: (vimrc: VimrcFile): Promise<VimrcFile> => findHost(vimrc.url).toFixedVimrc(vimrc),
  };
};

/**
 * Host operations shared by the reading vimrc features.
 */
export type VimrcHosts = ReturnType<typeof createVimrcHosts>;
