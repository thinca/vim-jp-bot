import {spawn, SpawnOptionsWithoutStdio} from "child_process";
import * as fse from "fs-extra";
import * as path from "path";

const sshCommand = path.join(path.dirname(__dirname), "bin", "ssh");

export class GitRepositoryUpdater {
  reposURL: string;
  workDir: string;
  keyFilePath: string;
  branch: string | undefined;

  constructor(reposURL: string, workDir: string, keyFilePath: string, opts: {branch?: string}) {
    this.reposURL = reposURL;
    this.workDir = workDir;
    this.keyFilePath = keyFilePath;
    opts = opts || {};
    this.branch = opts.branch;
  }

  async setup(): Promise<void> {
    const result = await this.setupWorkDir();
    if (!result.workDirCreated) {
      return await this.updateReposToLatest();
    }
  }

  async setupWorkDir(): Promise<{workDirCreated: boolean}> {
    if (await fse.pathExists(this.workDir)) {
      return {workDirCreated: false};
    }
    const args = ["clone", this.reposURL, this.workDir];
    if (this.branch) {
      args.push("--branch", this.branch);
    }

    await this._execGit(args, true);
    return {workDirCreated: true};
  }

  async commitAndPush(message: string): Promise<string> {
    const git = this._execGit.bind(this);
    await git(["add", "."]);
    await git(["commit", "--message", message]);
    const branch = this.branch || "HEAD";
    await git(["push", "origin", branch]);
    return message;
  }

  async updateReposToLatest(): Promise<void> {
    const git = this._execGit.bind(this);
    await git(["fetch"]);
    const branch = this.branch || "master";
    await git(["reset", "--hard", `origin/${branch}`]);
  }

  _execGit(args: string[], clone = false): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const opts: SpawnOptionsWithoutStdio = {
        env: Object.assign({
          GIT_SSH: sshCommand,
          SSH_KEY_PATH: this.keyFilePath,
        }, process.env),
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
            stderr: stderrString,
          });
        } else {
          resolve(true);
        }
      });
    });
  }
}
