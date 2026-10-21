import type {Fetch, VimrcFile} from "../types";
import {createGitHub, makeGithubURLInfo, makeRawURL as makeGitHubRawURL} from "./github";

/**
 * Splits a vimrc URL into the vimrc entry and its author.
 * @throws When the URL is on an unsupported host.
 */
export const parseVimrcURL = (url: string): {vimrc: VimrcFile, author: {name: string, url: string}} =>
  makeGithubURLInfo(url);

/**
 * Builds the URL that serves the plain text of a vimrc URL.
 * @throws When the URL is on an unsupported host.
 */
export const makeRawURL = (url: string): string => makeGitHubRawURL(url);

/**
 * Creates the operations that need network access.
 * @param token GitHub API token.
 */
export const createVimrcHosts = ({fetch, token}: {fetch: Fetch, token?: string}) => {
  const github = createGitHub({fetch, token});
  return {
    /**
     * Pins a vimrc to a commit, asking the host for the latest commit when the vimrc has no hash.
     * @returns The vimrc with the URL, the raw URL, and the hash on that commit.
     */
    toFixedVimrc: (vimrc: VimrcFile): Promise<VimrcFile> => github.toFixedVimrc(vimrc),
  };
};
