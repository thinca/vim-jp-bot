const {spawn} = require("child_process");
const fsp = require("fs-promise");
const path = require("path");

const sshCommand = path.join(path.dirname(__dirname), "bin", "ssh");

class GitRepositoryUpdater {
  constructor(reposURL, workDir, keyFilePath, opts) {
    this.reposURL = reposURL;
    this.workDir = workDir;
    this.keyFilePath = keyFilePath;
    opts = opts || {};
    this.branch = opts.branch;
  }

  setup() {
    return this.setupWorkDir().then((result) => {
      if (!result.workDirCreated) {
        return this.updateReposToLatest();
      }
    });
  }

  setupWorkDir() {
    return fsp.stat(this.workDir)
      .then((stats) => {
        if (stats.isDirectory()) {
          return {workDirCreated: false};
        }
      }).catch(() => {
        const args = ["clone", this.reposURL, this.workDir];
        if (this.branch) {
          args.push("--branch", this.branch);
        }

        return this._execGit(args, true).then(() => ({workDirCreated: true}));
      });
  }

  commitAndPush(message) {
    const git = this._execGit.bind(this);
    return git(["add", "."]).then(() => {
      return git(["commit", "--message", message]);
    }).then(() => {
      const branch = this.branch || "HEAD";
      return git(["push", "origin", branch]);
    }).then(() => message);
  }

  updateReposToLatest() {
    const git = this._execGit.bind(this);
    return git(["fetch"]).then(() => {
      const branch = this.branch || "master";
      return git(["reset", "--hard", `origin/${branch}`]);
    });
  }

  _execGit(args, clone = false) {
    return new Promise((resolve, reject) => {
      const opts = {
        env: Object.assign({
          GIT_SSH: sshCommand,
          SSH_KEY_PATH: this.keyFilePath
        }, process.env)
      };
      if (!clone) {
        opts.cwd = this.workDir;
      }
      const proc = spawn("git", args, opts);
      let stdoutString = "";
      proc.stdout.on("data", (chunk) => {
        stdoutString += chunk;
      });
      let stderrString = "";
      proc.stderr.on("data", (chunk) => {
        stderrString += chunk;
      });
      proc.on("exit", (code, signal) => {
        if (code) {
          reject({
            command: "git",
            args: args,
            code: code,
            signal: signal,
            stdout: stdoutString,
            stderr: stderrString
          });
        } else {
          resolve(true);
        }
      });
    });
  }
}

module.exports = GitRepositoryUpdater;
