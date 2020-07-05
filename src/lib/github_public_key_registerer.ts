import * as fse from "fs-extra";
import * as path from "path";
import {Octokit} from "@octokit/rest";
import keygen = require("ssh-keygen");

interface KeygenResult {
  pubKey: string;
}

const generateKeyPair = (location: string): Promise<KeygenResult> => {
  const opts = {
    type: "rsa",
    size: 4096,
    location: location,
    comment: "A key for auto deploy",
  };
  return new Promise((resolve, reject) => {
    keygen(opts, (err: unknown, keypair: KeygenResult) => {
      if (err) {
        reject(err);
      } else {
        resolve(keypair);
      }
    });
  });
};

const addPublicKey = (githubAPIToken: string, publicKey: string) => {
  const octokit = new Octokit({
    auth: githubAPIToken,
  });
  return octokit.users.createPublicSshKeyForAuthenticated({
    title: "A key for auto deploy from bot",
    key: publicKey,
  });
};

export class GithubPublicKeyRegisterer {
  readonly keyDir: string;
  readonly githubAPIToken: string;
  readonly keyFileName: string;

  constructor(keyDir: string, githubAPIToken: string, keyFileName = "bot_deploy_rsa") {
    this.keyDir = keyDir;
    this.githubAPIToken = githubAPIToken;
    this.keyFileName = keyFileName;
  }

  get keyPath(): string {
    return path.join(this.keyDir, this.keyFileName);
  }

  async setup(): Promise<string> {
    const keyPath = this.keyPath;
    if (await fse.pathExists(keyPath)) {
      return keyPath;
    }
    const keypair = await generateKeyPair(keyPath);
    await addPublicKey(this.githubAPIToken, keypair.pubKey);
    return keyPath;
  }
}
