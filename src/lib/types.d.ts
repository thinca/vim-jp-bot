export interface VimrcFile {
  url: string;
  raw_url?: string;
  name: string;
  hash: string | null;
}

export interface NextVimrc {
  id: number;
  date: string;
  author: {
    name: string;
    url: string;
  };
  vimrcs: VimrcFile[];
  part: string | null;
  other: string | null;
}

export interface ArchiveVimrc extends NextVimrc {
  members?: string[];
  log?: string;
}
