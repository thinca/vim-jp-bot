const fse = require("fs-extra");
const path = require("path");
const Octokit = require("@octokit/rest");
const keygen = require("ssh-keygen2");

const generateKeyPair = (location) => {
  const opts = {
    type: "rsa",
    bits: 4096,
    location: location,
    keep: true,
    comment: "A key for auto deploy",
  };
  return new Promise((resolve, reject) => {
    keygen(opts, (err, keypair) => {
      if (err) {
        reject(err);
      } else {
        resolve(keypair);
      }
    });
  });
};

const addPublicKey = (githubAPIToken, publicKey) => {
  const octokit = new Octokit({
    auth: `token ${githubAPIToken}`,
  });
  return octokit.users.createPublicKey({
    title: "A key for auto deploy from bot",
    key: publicKey,
  });
};

class GithubPublicKeyRegisterer {
  constructor(keyDir, githubAPIToken, keyFileName = "bot_deploy_rsa") {
    this.keyDir = keyDir;
    this.githubAPIToken = githubAPIToken;
    this.keyFileName = keyFileName;
  }

  get keyPath() {
    return path.join(this.keyDir, this.keyFileName);
  }

  async setup() {
    const keyPath = this.keyPath;
    try {
      const stats = await fse.stat(keyPath);
      if (stats.isFile()) {
        return keyPath;
      }
    } catch (e) {
      const keypair = await generateKeyPair(keyPath);
      await addPublicKey(this.githubAPIToken, keypair.public);
      return keyPath;
    }
  }
}

module.exports = GithubPublicKeyRegisterer;
