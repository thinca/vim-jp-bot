const fse = require("fs-extra");
const path = require("path");
const {Octokit} = require("@octokit/rest");
const keygen = require("ssh-keygen");

const generateKeyPair = (location) => {
  const opts = {
    type: "rsa",
    size: 4096,
    location: location,
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
    auth: githubAPIToken,
  });
  return octokit.users.createPublicSshKeyForAuthenticated({
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
    if (await fse.pathExists(keyPath)) {
      return keyPath;
    }
    const keypair = await generateKeyPair(keyPath);
    await addPublicKey(this.githubAPIToken, keypair.pubKey);
    return keyPath;
  }
}

module.exports = GithubPublicKeyRegisterer;
