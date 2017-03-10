const fsp = require("fs-promise");
const mkdirp = require("mkdirp-promise");
const path = require("path");
const YAML = require("js-yaml");
const printf = require("printf");
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
  const date = new Date(/^\d+-\d+-\d+/.exec(dateString)[0]);
  date.setDate(date.getDate() + 7);
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()} 23:00`;
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

  setup() {
    const keyDir = path.join(this.baseWorkDir, ".ssh");
    const registererPromise = fsp.stat(keyDir).catch(() => {
      return mkdirp(keyDir);
    }).then(() => {
      const registerer = new GithubPublicKeyRegisterer(keyDir, this.githubAPIToken);
      return registerer.setup();
    });

    const siteUpdaterPromise = registererPromise.then((keyFilePath) => {
      const reposURL = `git@github.com:${this.repository}`;
      const workDir = path.join(this.baseWorkDir, "gh-pages");
      const opts = {branch: "gh-pages"};
      this.siteUpdater = new GitRepositoryUpdater(reposURL, workDir, keyFilePath, opts);
      return this.siteUpdater.setup();
    });
    const wikiUpdaterPromise = registererPromise.then((keyFilePath) => {
      const reposURL = `git@github.com:${this.repository}.wiki`;
      const workDir = path.join(this.baseWorkDir, "wiki");
      const opts = {branch: "master"};
      this.wikiUpdater = new GitRepositoryUpdater(reposURL, workDir, keyFilePath, opts);
      return this.wikiUpdater.setup();
    });
    return Promise.all([siteUpdaterPromise, wikiUpdaterPromise]);
  }

  finish(resultData) {
    return this.siteUpdater.updateReposToLatest()
      .then(() => this._updateArchiveYAML(resultData))
      .then(() => this._addArchiveMarkdown(resultData.id))
      .then(() => this.siteUpdater.commitAndPush(`Add archive for #${resultData.id}`))
      .then(() => this.removeWikiEntry(resultData));
  }

  next(nexts, resultData) {
    return this.siteUpdater.updateReposToLatest()
      .then(() => this._updateNextYAML(nexts, resultData))
      .then((nextData) => {
        const message = `Update the next information: #${nextData.id} ${nextData.author.name}`;
        return this.siteUpdater.commitAndPush(message).then(() => nextData);
      });
  }

  removeWikiEntry(resultData) {
    const name = resultData.author.name;
    return this.wikiUpdater.updateReposToLatest()
      .then(() => this._removeNameFromWikiFile(name))
      .then((needPush) => {
        if (needPush) {
          return this.wikiUpdater.commitAndPush(`Remove ${name} (#${resultData.id})`);
        }
      });
  }

  _removeNameFromWikiFile(name) {
    const requestFile = path.join(this.wikiUpdater.workDir, "Request.md");
    return fsp.readFile(requestFile, "utf-8").then((content) => {
      const lines = content.split("\n");
      const namePat = new RegExp(`^${name}\\s*\\|`);
      const newLines = lines.filter((line) => !namePat.test(line));
      if (lines.length === newLines.length) {
        return false;
      }
      return fsp.writeFile(requestFile, newLines.join("\n")).then(() => true);
    });
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

  _updateNextYAML(nexts, resultData) {
    const yamlPath = this.nextYAMLFilePath;
    const urls = nexts.filter((next) => next.match(/^http/));
    const others = nexts.filter((next) => !next.match(/^http/));
    const part = others.find((o) => /^.+編$/.test(o)) || null;

    if (urls.length === 0 && !part) {
      return Promise.reject("Need {nexts} parameter");
    }

    const isContinuous = urls.length === 0;
    const nextVimrcUrls =
      isContinuous ? resultData.vimrcs.map((vimrc) => vimrc.url) : urls;

    const nextVimrcData = nextVimrcUrls.map((url) => {
      const paths = url.split("/");
      // XXX: Assume GitHub URL
      return {
        url: url,
        name: paths[paths.length - 1],
        author_name: paths[3],
        author_url: paths.slice(0, 4).join("/")
      };
    });

    return fsp.readFile(yamlPath).then((currentYaml) => {
      const nextData = YAML.safeLoad(currentYaml)[0];
      nextData.id++;
      nextData.date = nextWeek(nextData.date);
      nextData.author = {
        name: nextVimrcData[0].author_name,
        url: nextVimrcData[0].author_url
      };
      const hash = isContinuous ? resultData.vimrcs[0].split("/")[6] : null;
      nextData.vimrcs = nextVimrcData.map((vimrc) => {
        return {
          url: vimrc.url,
          name: vimrc.name,
          hash: hash
        };
      });
      nextData.part = part;

      return fsp.writeFile(yamlPath, YAML.safeDump([nextData])).then(() => nextData);
    });
  }
}

module.exports = ReadingVimrcRepos;
