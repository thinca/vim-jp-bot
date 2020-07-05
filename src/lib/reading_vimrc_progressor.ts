import {Message} from "hubot";
import {VimrcFile} from "./types";

export class ReadingVimrcProgressor {
  id: number;
  logURL: string;
  messages: Message[];
  restore_cache: Message[];
  vimrcs: VimrcFile[];
  isRunning: boolean;
  vimrcContents: Map<string, string[]>;
  vimrcLastname: Map<string, string>;
  part: string | null;

  constructor() {
    this.id = 0;
    this.logURL = "";
    this.messages = [];
    this.restore_cache = [];
    this.vimrcs = [];
    this.isRunning = false;
    this.vimrcContents = new Map();
    this.vimrcLastname = new Map();
    this.part = null;
  }

  get status(): "started" | "stopped" {
    return this.isRunning ? "started" : "stopped";
  }

  get members(): string[] {
    return [...new Set(this.messages.map((mes) => mes.user.login as string)).values()].filter((m) => m);
  }

  start(id: number, logURL: string, vimrcs: VimrcFile[], part: string | null): void {
    this.id = id;
    this.logURL = logURL;
    this.vimrcs = vimrcs;
    this.messages = [];
    this.isRunning = true;
    this.part = part;
    this.clearVimrcs();
  }

  stop(): void {
    this.isRunning = false;
  }

  reset(): void {
    this.restore_cache = this.messages;
    this.messages = [];
  }

  restore(): void {
    [this.restore_cache, this.messages] = [this.messages, this.restore_cache];
  }

  addMessage(message: Message): void {
    if (!this.isRunning) {
      return;
    }
    this.messages.push(message);
  }

  setVimrcContent(name: string, content: string): void {
    this.vimrcContents.set(name, content.split(/\r?\n/));
  }

  getVimrcFile(namePat: string, username: string): [string, string[]] | [] {
    const names = [...this.vimrcContents.keys()];
    let name: string | undefined;
    if (namePat) {
      const patternCandidates = [
        `^${namePat}$`,
        `/${namePat}$`,
        `/${namePat}(?:\\..*)?$`,
        namePat,
      ];
      for (const pat of patternCandidates) {
        const reg = new RegExp(pat, "i");
        name = names.find((n) => reg.test(n));
        if (name) {
          break;
        }
      }
    } else if (this.vimrcLastname.has(username)) {
      name = this.vimrcLastname.get(username);
    } else {
      name = names[0];
    }
    if (name == null || !this.vimrcContents.has(name)) {
      return [];
    }
    if (username) {
      this.vimrcLastname.set(username, name);
    }
    return [name, this.vimrcContents.get(name) || []];
  }

  getVimrcLines(content: string[], startLine: number, endLine = startLine): string[] {
    return content.slice(startLine - 1, endLine);
  }

  clearVimrcs(): void {
    this.vimrcContents.clear();
    this.vimrcLastname.clear();
  }
}
