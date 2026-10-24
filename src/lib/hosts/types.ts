import type {VimrcFile} from "../types";

export interface VimrcURLInfo {
  vimrc: VimrcFile;
  author: {
    name: string;
    url: string;
  };
}

/**
 * How one Git hosting service lays out its vimrc URLs and reports its latest commit.
 */
export interface VimrcHost {
  readonly hostname: string;
  /**
   * Splits a vimrc URL into the vimrc entry and its author.
   */
  parseURL(url: string): VimrcURLInfo;
  /**
   * Builds the URL that serves the plain text of a vimrc URL on the same ref.
   */
  makeRawURL(url: string): string;
  /**
   * Pins a vimrc to a commit, asking the host for the latest commit when the vimrc has no hash.
   * @returns The vimrc with the URL, the raw URL, and the hash on that commit.
   */
  toFixedVimrc(vimrc: VimrcFile): Promise<VimrcFile>;
}
