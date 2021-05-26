import * as path from "path";
import {URL} from "url";
import * as fs from "fs/promises";
import * as YAML from "js-yaml";
import {default as fetch} from "node-fetch";
import {default as printf} from "printf";
import {ArchiveVimrc, NextVimrc, VimrcFile} from "./types";
import {GitRepositoryUpdater} from "./git_repository_updater";
import {GithubPublicKeyRegisterer} from "./github_public_key_registerer";

const TEMPLATE_TEXT = `---
layout: archive
title: 第%d回 vimrc読書会
id: %d
category: archive
---
{%% include archive.md %%}
`;

const nextWeek = (dateString: string): string => {
  const [year, month, day] = dateString.split(/\D+/).map((n) => Number.parseInt(n, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setDate(date.getDate() + 7);
  return printf(
    "%04d-%02d-%02d 23:00",
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
};

const makeRawURL = (urlString: string): string => {
  const url = new URL(urlString);
  url.hostname = "raw.githubusercontent.com";
  const pathnames = url.pathname.split("/");
  pathnames.splice(3, 1);
  url.pathname = pathnames.join("/");
  return url.toString();
};

const makeWikiRequestLine = (author: string, requester: string, urlString: string, lineNum: number, comment?: string) => {
  return `${author} | ${lineNum} | ${requester} | ${comment || ""} | [リンク](${urlString})`;
};

const makeGithubURLInfo = (url: string): {vimrc: VimrcFile, author: {name: string, url: string}} => {
  const paths = url.split("/");
  // XXX: Assume GitHub URL
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


export class ReadingVimrcRepos {
  readonly repository: string;
  readonly baseWorkDir: string;
  readonly githubAPIToken: string;
  siteUpdater: GitRepositoryUpdater | undefined;
  wikiUpdater: GitRepositoryUpdater | undefined;

  constructor(repository: string, baseWorkDir: string, githubAPIToken: string) {
    this.repository = repository;
    this.baseWorkDir = baseWorkDir;
    this.githubAPIToken = githubAPIToken;
  }

  get nextYAMLFilePath(): string {
    return this.siteUpdater ? path.join(this.siteUpdater.workDir, "_data", "next.yml") : "";
  }

  get archiveYAMLFilePath(): string {
    return this.siteUpdater ? path.join(this.siteUpdater.workDir, "_data", "archives.yml") : "";
  }

  async readNextYAMLData(): Promise<NextVimrc> {
    const text = await fs.readFile(this.nextYAMLFilePath, "utf-8");
    return (YAML.load(text) as NextVimrc[])[0];
  }

  async readArchiveYAMLData(): Promise<ArchiveVimrc[]> {
    const text = await fs.readFile(this.archiveYAMLFilePath, "utf-8");
    return YAML.load(text) as ArchiveVimrc[];
  }

  async readTargetMembers(): Promise<Set<string>> {
    const yaml = await this.readArchiveYAMLData();
    return new Set(yaml.map((entry) => entry.author.name));
  }

  async setup(): Promise<void> {
    const keyDir = path.join(this.baseWorkDir, ".ssh");
    await fs.mkdir(keyDir, {recursive: true});
    const registerer = new GithubPublicKeyRegisterer(keyDir, this.githubAPIToken);
    const keyFilePath = await registerer.setup();

    {
      const reposURL = `git@github.com:${this.repository}`;
      const workDir = path.join(this.baseWorkDir, "gh-pages");
      const opts = {branch: "gh-pages"};
      this.siteUpdater = new GitRepositoryUpdater(reposURL, workDir, keyFilePath, opts);
    }

    {
      const reposURL = `git@github.com:${this.repository}.wiki`;
      const workDir = path.join(this.baseWorkDir, "wiki");
      const opts = {branch: "master"};
      this.wikiUpdater = new GitRepositoryUpdater(reposURL, workDir, keyFilePath, opts);
    }

    await Promise.all([this.siteUpdater.setup(), this.wikiUpdater.setup()]);
  }

  async finish(resultData: ArchiveVimrc): Promise<void> {
    if (!this.siteUpdater) {
      throw new Error("need setup");
    }
    await this.siteUpdater.updateReposToLatest();
    await this._updateArchiveYAML(resultData);
    await this._addArchiveMarkdown(resultData.id);
    await this.siteUpdater.commitAndPush(`Add archive for #${resultData.id}`);
    await this.removeWikiEntry(resultData);
  }

  async next(nexts: string[], resultData: ArchiveVimrc): Promise<NextVimrc> {
    if (!this.siteUpdater) {
      throw new Error("need setup");
    }
    await this.siteUpdater.updateReposToLatest();
    const nextData = await this._updateNextYAML(nexts, resultData);
    const message = `Update the next information: #${nextData.id} ${nextData.author.name}`;
    await this.siteUpdater.commitAndPush(message);
    return nextData;
  }

  async addWikiEntry(requester: string, author: string, urlString: string, comment?: string): Promise<boolean> {
    if (!this.wikiUpdater) {
      throw new Error("need setup");
    }
    await this.wikiUpdater.updateReposToLatest();
    const needPush = await this._addNameToWikiFile(requester, author, urlString, comment);
    if (needPush) {
      await this.wikiUpdater.commitAndPush(`Add ${author}`);
    }
    return needPush;
  }

  async removeWikiEntry(resultData: ArchiveVimrc): Promise<boolean> {
    if (!this.wikiUpdater) {
      throw new Error("need setup");
    }
    const name = resultData.author.name;
    await this.wikiUpdater.updateReposToLatest();
    const needPush = await this._removeNameFromWikiFile(name);
    if (needPush) {
      await this.wikiUpdater.commitAndPush(`Remove ${name} (#${resultData.id})`);
    }
    return needPush;
  }

  async _addNameToWikiFile(requester: string, author: string, urlString: string, comment?: string): Promise<boolean> {
    const rawURL = makeRawURL(urlString);
    const res = await fetch(rawURL);
    const text = await res.text();
    const lineNum = text.split("\n").length;
    return await this._updateRequestFile((lines) => {
      if (0 <= lines.findIndex((line) => line.startsWith(`${author} `))) {
        return lines;
      }
      const index = lines.findIndex((line) => /^\.\.\./.test(line));
      if (0 <= index) {
        const newLine = makeWikiRequestLine(author, requester, urlString, lineNum, comment);
        lines.splice(index, 0, newLine);
      }
      return lines;
    });
  }

  async _removeNameFromWikiFile(name: string): Promise<boolean> {
    return await this._updateRequestFile((lines) => {
      const namePat = new RegExp(`^${name}\\s*\\|`);
      return lines.filter((line) => !namePat.test(line));
    });
  }

  async _updateRequestFile(callback: (lines: string[]) => string[]): Promise<boolean> {
    if (!this.wikiUpdater) {
      throw new Error("need setup");
    }
    const requestFile = path.join(this.wikiUpdater.workDir, "Request.md");
    const content = await fs.readFile(requestFile, "utf-8");
    const lines = content.split("\n");
    const origLength = lines.length;
    const newLines = callback(lines);

    // This function only updates with add/remove lines
    if (origLength === newLines.length) {
      return false;
    }
    await fs.writeFile(requestFile, newLines.join("\n"));
    return true;
  }

  async _updateArchiveYAML(resultData: ArchiveVimrc): Promise<void> {
    if (!this.siteUpdater) {
      throw new Error("need setup");
    }
    const yamlPath = path.join(this.siteUpdater.workDir, "_data", "archives.yml");
    const yamlEntry = YAML.dump([resultData], {lineWidth: 1000});
    await fs.appendFile(yamlPath, yamlEntry);
  }

  async _addArchiveMarkdown(id: number): Promise<void> {
    if (!this.siteUpdater) {
      throw new Error("need setup");
    }
    const archivePath = path.join(this.siteUpdater.workDir, "archive", printf("%03d.md", id));
    const archiveBody = printf(TEMPLATE_TEXT, id, id);
    await fs.writeFile(archivePath, archiveBody);
  }

  async _updateNextYAML(nexts: string[], resultData: ArchiveVimrc): Promise<NextVimrc> {
    const urls = nexts.filter((next) => next.match(/^http/));
    const others = nexts.filter((next) => !next.match(/^http/));
    const part = others.find((o) => /^.+編$/.test(o)) || null;

    if (urls.length === 0 && !part) {
      throw "Need {nexts} parameter";
    }

    const isContinuous = urls.length === 0;
    const nextVimrcURLs =
      isContinuous ? resultData.vimrcs.map((vimrc) => vimrc.url) : urls;

    const nextVimrcData = nextVimrcURLs.map(makeGithubURLInfo);
    const data = nextVimrcData[0];

    const nextData = await this.readNextYAMLData();
    const date = new Date(nextData.date);
    if (date.getTime() < Date.now()) {
      nextData.id++;
      nextData.date = nextWeek(nextData.date);
    }
    nextData.author = data.author;
    nextData.vimrcs = nextVimrcData.map((data) => data.vimrc);
    nextData.part = part;

    const yamlPath = this.nextYAMLFilePath;
    await fs.writeFile(yamlPath, YAML.dump([nextData]));
    return nextData;
  }
}
