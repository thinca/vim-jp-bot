const fsp = require("fs-promise");
const fetch = require("node-fetch");
const mkdirp = require("mkdirp-promise");
const path = require("path");
const YAML = require("js-yaml");
const printf = require("printf");
const {URL} = require("url");
const GitRepositoryUpdater = require("./git_repository_updater");
const GithubPublicKeyRegisterer = require("./github_public_key_registerer");

const TEMPLATE_TEXT = `---
layout: archive
title: 第%d回 vimrc読書会
id: %d
category: archive
---
{%% include archive.md %%}
`;

const nextWeek = (dateString) => {
  const [year, month, day] = dateString.split(/\D+/).map((n) => Number.parseInt(n, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setDate(date.getDate() + 7);
  return printf(
    "%04d-%02d-%02d 23:00",
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  );
};

class ReadingVimrcRepos {
  constructor(repository, baseWorkDir, githubAPIToken) {
    this.repository = repository;
    this.baseWorkDir = baseWorkDir;
    this.githubAPIToken = githubAPIToken;
  }

  get nextYAMLFilePath() {
    return path.join(this.siteUpdater.workDir, "_data", "next.yml");
  }

  get archiveYAMLFilePath() {
    return path.join(this.siteUpdater.workDir, "_data", "archives.yml");
  }

  async readNextYAMLData() {
    const text = await fsp.readFile(this.nextYAMLFilePath);
    return YAML.safeLoad(text)[0];
  }

  async readArchiveYAMLData() {
    const text = await fsp.readFile(this.archiveYAMLFilePath);
    return YAML.safeLoad(text);
  }

  async readTargetMembers() {
    const yaml = await this.readArchiveYAMLData();
    return new Set(yaml.map((entry) => entry.author.name));
  }

  async setup() {
    const keyDir = path.join(this.baseWorkDir, ".ssh");
    try {
      await fsp.stat(keyDir);
    } catch (e) {
      mkdirp(keyDir);
    }
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

  async finish(resultData) {
    await this.siteUpdater.updateReposToLatest();
    await this._updateArchiveYAML(resultData);
    await this._addArchiveMarkdown(resultData.id);
    await this.siteUpdater.commitAndPush(`Add archive for #${resultData.id}`);
    await this.removeWikiEntry(resultData);
  }

  async next(nexts, resultData) {
    await this.siteUpdater.updateReposToLatest();
    const nextData = await this._updateNextYAML(nexts, resultData);
    const message = `Update the next information: #${nextData.id} ${nextData.author.name}`;
    await this.siteUpdater.commitAndPush(message);
    return nextData;
  }

  async addWikiEntry(requester, author, urlString, comment) {
    await this.wikiUpdater.updateReposToLatest();
    const needPush = await this._addNameToWikiFile(requester, author, urlString, comment);
    if (needPush) {
      await this.wikiUpdater.commitAndPush(`Add ${author}`);
    }
  }

  async removeWikiEntry(resultData) {
    const name = resultData.author.name;
    await this.wikiUpdater.updateReposToLatest();
    const needPush = await this._removeNameFromWikiFile(name);
    if (needPush) {
      await this.wikiUpdater.commitAndPush(`Remove ${name} (#${resultData.id})`);
    }
  }

  async _addNameToWikiFile(requester, author, urlString, comment) {
    const rawURL = makeRawURL(urlString);
    const res = await fetch(rawURL);
    const text = await res.text();
    const lineNum = text.split("\n").length;
    await this._updateRequestFile((lines) => {
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

  async _removeNameFromWikiFile(name) {
    await this._updateRequestFile((lines) => {
      const namePat = new RegExp(`^${name}\\s*\\|`);
      return lines.filter((line) => !namePat.test(line));
    });
  }

  async _updateRequestFile(callback) {
    const requestFile = path.join(this.wikiUpdater.workDir, "Request.md");
    const content = await fsp.readFile(requestFile, "utf-8");
    const lines = content.split("\n");
    const origLength = lines.length;
    const newLines = callback(lines);

    // This function only updates with add/remove lines
    if (origLength === newLines.length) {
      return false;
    }
    await fsp.writeFile(requestFile, newLines.join("\n"));
    return true;
  }

  _updateArchiveYAML(resultData) {
    const yamlPath = path.join(this.siteUpdater.workDir, "_data", "archives.yml");
    const yamlEntry = YAML.safeDump([resultData], {lineWidth: 1000});
    return fsp.appendFile(yamlPath, yamlEntry);
  }

  _addArchiveMarkdown(id) {
    const archivePath = path.join(this.siteUpdater.workDir, "archive", printf("%03d.md", id));
    const archiveBody = printf(TEMPLATE_TEXT, id, id);
    return fsp.writeFile(archivePath, archiveBody);
  }

  makeGithubURLInfo(url) {
    const paths = url.split("/");
    // XXX: Assume GitHub URL
    const hash = /^[0-9a-f]{40}$/.test(paths[6]) ? paths[6] : null;
    return {
      url,
      hash,
      name: paths[paths.length - 1],
      author: {
        name: paths[3],
        url: paths.slice(0, 4).join("/"),
      },
    };
  }

  async _updateNextYAML(nexts, resultData) {
    const yamlPath = this.nextYAMLFilePath;
    const urls = nexts.filter((next) => next.match(/^http/));
    const others = nexts.filter((next) => !next.match(/^http/));
    const part = others.find((o) => /^.+編$/.test(o)) || null;

    if (urls.length === 0 && !part) {
      throw "Need {nexts} parameter";
    }

    const isContinuous = urls.length === 0;
    const nextVimrcURLs =
      isContinuous ? resultData.vimrcs.map((vimrc) => vimrc.url) : urls;

    const nextVimrcData = nextVimrcURLs.map(this.makeGithubURLInfo);
    const data = nextVimrcData[0];

    const currentYaml = await fsp.readFile(yamlPath);
    const nextData = YAML.safeLoad(currentYaml)[0];
    const date = new Date(nextData.date);
    if (date.getTime() < Date.now()) {
      nextData.id++;
      nextData.date = nextWeek(nextData.date);
    }
    nextData.author = data.author;
    const hash = isContinuous ? data.hash : null;
    nextData.vimrcs = nextVimrcData.map((vimrc) => {
      return {
        url: vimrc.url,
        name: vimrc.name,
        hash: hash,
      };
    });
    nextData.part = part;

    await fsp.writeFile(yamlPath, YAML.safeDump([nextData]));
    return nextData;
  }
}

const makeRawURL = (urlString) => {
  const url = new URL(urlString);
  url.hostname = "raw.githubusercontent.com";
  const pathnames = url.pathname.split("/");
  pathnames.splice(3, 1);
  url.pathname = pathnames.join("/");
  return url.toString();
};

const makeWikiRequestLine = (author, requester, urlString, lineNum, comment) => {
  return `${author} | ${lineNum} | ${requester} | ${comment || ""} | [リンク](${urlString})`;
};

module.exports = ReadingVimrcRepos;
