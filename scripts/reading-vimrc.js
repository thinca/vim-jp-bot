// Description:
//   Supports reading vimrc.
//   http://vim-jp.org/reading-vimrc/
//

const YAML = require("js-yaml");
const Octokat = new (require("octokat"))();
const printf = require("printf");

const ROOM_NAME = process.env.HUBOT_READING_VIMRC_ROOM_NAME || "vim-jp/reading-vimrc";
const ADMIN_USERS = (process.env.HUBOT_READING_VIMRC_ADMIN_USERS || "").split(/,/);

class ReadingVimrc {
  constructor() {
    this.id = 0;
    this.startLink = "";
    this.messages = [];
    this.vimrcs = [];
    this.isRunning = false;
    this.vimrcContents = new Map();
  }

  get status() {
    return this.isRunning ? "started" : "stopped";
  }

  get members() {
    return [...new Set(this.messages.map((mes) => mes.user.name)).values()];
  }

  start(id, link, vimrcs) {
    this.id = id;
    this.startLink = link;
    this.vimrcs = vimrcs;
    this.messages = [];
    this.isRunning = true;
  }

  stop() {
    this.isRunning = false;
  }

  reset() {
    this.restore_cache = this.messages;
    this.messages = [];
  }

  restore() {
    [this.restore_cache, this.messages] = [this.messages, this.restore_cache];
  }

  add(message) {
    if (!this.isRunning) {
      return;
    }
    this.messages.push(message);
  }

  setVimrcContent(name, content) {
    this.vimrcContents.set(name, content.split(/\r?\n/));
  }

  getVimrcLines(name, startLine, endLine = startLine) {
    let keys = [...this.vimrcContents.keys()];
    let key;
    if (name) {
      let reg = new RegExp(name, "i");
      key = keys.find((k) => reg.test(k));
    } else {
      key = keys[0];
    }
    if (!this.vimrcContents.has(key)) {
      return null;
    }
    let content = this.vimrcContents.get(key);
    return content.slice(startLine - 1, endLine);
  }

  help() {
    return `vimrc読書会で発言した人を集計するための bot です

!reading_vimrc {command}

"start"   : 集計の開始、"member" は "reset" される(owner)
"stop"    : 集計の終了(owner)
"reset"   : "member" をリセット(owner)
"restore" : "member" を1つ前に戻す(owner)
"status"  : ステータスの出力
"member"  : "start" ～ "stop" の間に発言した人を列挙
"member_with_count" : "member" に発言数も追加して列挙
"help"    : 使い方を出力
"start"   : vimrc読書会を開始します(owner)
"start_reading_vimrc" : vimrc読書会を開始します(owner)`;
  }

  startingMessage(data, vimrcs) {
    return `=== 第${data.id}回 vimrc読書会 ===
- 途中参加/途中離脱OK。声をかける必要はありません
- 読む順はとくに決めないので、好きなように読んで好きなように発言しましょう
- vimrc 内の特定位置を参照する場合は行番号で L100 のように指定します
- 特定の相手に発言/返事する場合は先頭に username: を付けます
- 一通り読み終わったら、読み終わったことを宣言してください。終了の目安にします
- ただの目安なので、宣言してからでも読み返して全然OKです${
    (() => {
      if (data.part === "前編") {
        return `
- 今回は${data.part}です。終了時間になったら、途中でも強制終了します
- 続きは来週読みます
- いつも通り各自のペースで読むので、どこまで読んだか覚えておきましょう`;
      }
      if (data.part === "中編") {
        return `
- 今回は${data.part}です。終了時間になったら、途中でも強制終了します
- 前回参加していた方は続きから、参加していなかったら最初からになります
- 続きは来週読みます
- いつも通り各自のペースで読むので、どこまで読んだか覚えておきましょう`;
      }
      if (data.part === "後編") {
        return `
- 今回は${data.part}です。前回参加した人は続きから読んでください`;
      }
      return "";
    })()}${
      vimrcs.map((vimrc) => `
${vimrc.name}: ${vimrc.link}
DL用リンク: ${vimrc.raw_link}`
                ).join("\n")
    }`;
  }
}

function lastCommitHash(url) {
  let [, username, reponame] = url.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)/);
  let repo = Octokat.repos(username, reponame);
  return repo.commits.fetch().then((value) => {
    return value.items[0].sha;
  });
}

function toGithubLink(vimrc) {
  vimrc.hash = undefined;
  let makeLinkData = (hash) => {
    vimrc.hash = hash;
    let link = /blob\/master\//.test(vimrc.url)
      ? vimrc.url.replace(/blob\/master\//, `blob/${hash}/`)
      : `${vimrc.url}/tree/${hash}`;
    let raw_link = vimrc.url
      .replace(/https:\/\/github/, "https://raw.githubusercontent")
      .replace(/blob\/master\//, `${hash}/`);
    return {
      link,
      raw_link,
      name: vimrc.name,
      base: vimrc,
      hash
    };
  };
  if (vimrc.hash) {
    return Promise.resolve(makeLinkData(vimrc.hash));
  } else {
    return lastCommitHash(vimrc.url).then(makeLinkData);
  }
}

function makeGitterLink(room, message) {
  return `https://gitter.im/${room}?at=${message.id}`;
}

function getNextYAML(robot) {
  return new Promise((resolve, reject) => {
    robot.http("https://raw.githubusercontent.com/vim-jp/reading-vimrc/gh-pages/_data/next.yml").get()((err, res, body) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(YAML.safeLoad(body)[0]);
    });
  });
}

function isAdmin(user) {
  return ADMIN_USERS.includes(user.name);
}

module.exports = (robot) => {
  let readingVimrc = new ReadingVimrc();
  let targetRoomId = 'Shell';  // for shell adapter on debug
  if (robot.adapterName === "gitter2") {
    robot.adapter._resolveRoom(ROOM_NAME, (room) => {
      targetRoomId = room.id();
    });
  }

  robot.listenerMiddleware((context, next, done) => {
    let user = context.response.envelope.user;
    let room = context.response.envelope.room;

    if (context.listener.options.admin && !isAdmin(user)) {
      done();
      return;
    }
    if (room === targetRoomId) {
      next();
    } else {
      done();
    }
  });
  robot.hear(/.*/i, (res) => {
    if (!(/^!reading_vimrc/.test(res.message.text))) {
      readingVimrc.add(res.message);
    }
  });
  robot.hear(/^(?:(\S+)\s+)?L(\d+)(?:-L?(\d+))?\s/, (res) => {
    let [, name, startLine, endLine] = res.match;
    startLine = Number.parseInt(startLine);
    endLine = endLine ? Number.parseInt(endLine) : undefined;
    let lines = readingVimrc.getVimrcLines(name, startLine, endLine);
    if (lines) {
      let body = lines.map((line, n) => printf("%4d | %s", n + startLine, line)).join("\n");
      res.send("```\n" + body + "\n```");
    }
  });
  robot.hear(/^!reading_vimrc[\s]+start(?:_reading_vimrc)?$/i, {admin: true}, (res) => {
    getNextYAML(robot).then((nextData) => {
      let link = makeGitterLink(ROOM_NAME, res.envelope.message);
      Promise.all(nextData.vimrcs.map(toGithubLink)).then((vimrcs) => {
        vimrcs.forEach((vimrc) => {
          robot.http(vimrc.raw_link).get()((err, httpRes, body) => {
            readingVimrc.setVimrcContent(vimrc.raw_link, body);
          });
        });
        readingVimrc.start(nextData.id, link, vimrcs);
        res.send(readingVimrc.startingMessage(nextData, vimrcs));
      });
    });
  });
  robot.hear(/^!reading_vimrc\s+stop$/, {admin: true}, (res) => {
    readingVimrc.stop();
    res.send("stopped");
  });
  robot.hear(/^!reading_vimrc\s+reset$/, {admin: true}, (res) => {
    readingVimrc.reset();
    res.send("reset");
  });
  robot.hear(/^!reading_vimrc\s+restore$/, {admin: true}, (res) => {
    readingVimrc.restore();
    res.send("restored");
  });
  robot.hear(/^!reading_vimrc\s+status$/, (res) => {
    res.send(readingVimrc.status);
  });
  robot.hear(/^!reading_vimrc\s+members?$/, (res) => {
    let members = readingVimrc.members;
    if (members.length === 0) {
      res.send("だれもいませんでした");
    } else {
      let lines = members;
      lines.sort();
      lines.push("\n", readingVimrc.startLink);
      res.send(lines.join("\n"));
    }
  });
  robot.hear(/^!reading_vimrc\s+members?_with_count$/, (res) => {
    let messages = readingVimrc.messages;
    if (messages.length === 0) {
      res.send("だれもいませんでした");
    } else {
      let entries = messages
        .map((mes) => mes.user.name)
        .reduce((map, currentValue) => {
          map.set(currentValue, (map.get(currentValue) || 0) + 1);
          return map;
        }, new Map())
        .entries();
      let lines = [...entries]
        .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
        .map(([name, count]) => printf("%03d回 : %s", count, name));
      lines.push("\n", readingVimrc.startLink);
      res.send(lines.join("\n"));
    }
  });
  robot.hear(/^!reading_vimrc\s+help/, (res) => {
    res.send(readingVimrc.help());
  });

  robot.router.get("/reading_vimrc/info.yml", (req, res) => {
    res.set("Content-Type", "application/x-yaml");
    getNextYAML(robot).then((nextData) => {
      nextData.members = readingVimrc.members.sort();
      nextData.log = readingVimrc.startLink;
      nextData.vimrcs = readingVimrc.vimrcs.map((vimrc) => (
        {
          name: vimrc.name,
          url: vimrc.link,
          raw_url: vimrc.raw_link
        }));
      res.send(YAML.safeDump([nextData], {lineWidth: 1000}));
    });
  });
  robot.router.get("/reading_vimrc", (req, res) => {
    res.set("Content-Type", "text/plain");
    res.send(`status: ${readingVimrc.status}
members:
${readingVimrc.members.sort().join("\n")}
link: ${readingVimrc.startLink}
`);
  });
};
