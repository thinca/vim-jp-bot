// Description:
//   Supports reading vimrc.
//   http://vim-jp.org/reading-vimrc/
//
// Dependencies:
//   js-yaml: 3.6.0
//   printf: 0.2.3
//
// Configuration:
//   HUBOT_READING_VIMRC_ROOM_NAME
//     Target room name.
//     This script works only on the specified room.
//   HUBOT_READING_VIMRC_ADMIN_USERS
//     Admin users.  This is comma separated list.
//     Some commands can be executed by admin users only.
//
// Commands:
//   !reading_vimrc start - Start the reading vimrc.  Admin only.
//   !reading_vimrc stop - Stop the reading vimrc.  Admin only.
//   !reading_vimrc reset - Reset the members of current reading vimrc.  Admin only.
//   !reading_vimrc restore - Restore the members.
//   !reading_vimrc status - Show the status(started or stopped).
//   !reading_vimrc member - List the members of current reading vimrc.
//   !reading_vimrc member_with_count - List of members with said count.
//   !reading_vimrc help - Show the help.
//
// Author:
//   thinca <thinca+npm@gmail.com>

const path = require("path");
const YAML = require("js-yaml");
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
    return [...new Set(this.messages.map((mes) => mes.user.login)).values()];
  }

  start(id, link, vimrcs, part) {
    this.id = id;
    this.startLink = link;
    this.vimrcs = vimrcs;
    this.messages = [];
    this.isRunning = true;
    this.part = part;
    this.clearVimrcs();
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

  getVimrcFile(namePat) {
    const keys = [...this.vimrcContents.keys()];
    let key;
    if (namePat) {
      key = [
        `^${namePat}$`,
        `/${namePat}(?:\..*)?$`,
        namePat
      ].reduce((k, pat) => {
        if (!k) {
          let reg = new RegExp(pat, "i");
          k = keys.find((k) => reg.test(k));
        }
        return k;
      }, null);
    } else {
      key = keys[0];
    }
    if (!this.vimrcContents.has(key)) {
      return [];
    }
    return [key, this.vimrcContents.get(key)];
  }

  getVimrcLines(content, startLine, endLine = startLine) {
    return content.slice(startLine - 1, endLine);
  }

  clearVimrcs() {
    this.vimrcContents.clear();
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
- vimrc 内の特定位置を参照する場合は行番号で L100 や L100-110 のように指定します
- 特定の相手に発言/返事する場合は \`@username\` を付けます
- 一通り読み終わったら、読み終わったことを宣言してください。終了の目安にします
- ただの目安なので、宣言してからでも読み返して全然OKです${
    (() => {
      switch (data.part) {
        case "前編":
          return `
- 今回は${data.part}です。終了時間になったら、途中でも強制終了します
- 続きは来週読みます
- いつも通り各自のペースで読むので、どこまで読んだか覚えておきましょう`;
        case "中編":
          return `
- 今回は${data.part}です。終了時間になったら、途中でも強制終了します
- 前回参加していた方は続きから、参加していなかったら最初からになります
- 続きは来週読みます
- いつも通り各自のペースで読むので、どこまで読んだか覚えておきましょう`;
        case "後編":
          return `
- 今回は${data.part}です。前回参加した人は続きから読みましょう`;
      }
      return "";
    })()}
今回読む vimrc:${
      vimrcs.map((vimrc) => `
[${vimrc.name}](${vimrc.link}) ([DL](${vimrc.raw_link}))`
                ).join("")
    }`;
  }
}

const lastCommitHash = (() => {
  // XXX: Should cache expire?
  const hashes = new Map();
  return (url, robot) => {
    const [, place] = url.match(/https:\/\/github\.com\/([^/]+\/[^/]+)/);
    // XXX Should `hashes` lock? How?
    if (hashes.has(place)) {
      return hashes.get(place);
    }
    const apiUrl = `https://api.github.com/repos/${place}/commits/HEAD`;
    const p = new Promise((resolve, reject) => {
      robot.http(apiUrl)
        .header("Accept", "application/vnd.github.VERSION.sha")
        .get()((err, res, body) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(body);
        });
    });
    hashes.set(place, p);
    return p;
  };
})();

function toGithubLink(vimrc, robot) {
  const makeLinkData = (hash) => {
    vimrc.hash = hash;
    const link = /blob\/master\//.test(vimrc.url)
      ? vimrc.url.replace(/blob\/master\//, `blob/${hash}/`)
      : `${vimrc.url}/tree/${hash}`;
    const raw_link = vimrc.url
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
    return lastCommitHash(vimrc.url, robot).then(makeLinkData);
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
  return ADMIN_USERS.includes(user.login || user.name);  // user.name for shell adapter
}

module.exports = (robot) => {
  const readingVimrc = new ReadingVimrc();
  let targetRoomId = 'Shell';  // for shell adapter on debug
  if (robot.adapterName === "gitter2") {
    robot.adapter._resolveRoom(ROOM_NAME, (room) => {
      targetRoomId = room.id();
    });
  }

  robot.listenerMiddleware((context, next, done) => {
    const user = context.response.envelope.user;
    const room = context.response.envelope.room;
    const options = context.listener.options;

    if (options.readingVimrc && room !== targetRoomId) {
      done();
      return;
    }
    if (options.admin && !isAdmin(user)) {
      done();
      return;
    }
    next();
  });
  robot.hear(/.*/i, {readingVimrc: true}, (res) => {
    if (!(/^!reading_vimrc/.test(res.message.text))) {
      readingVimrc.add(res.message);
    }
  });
  robot.hear(/^(?:(\S+)\s+)??(L\d+(?:-L?\d+)?(?:(?:\s+L|,L?)\d+(?:-L?\d+)?)*)/, {readingVimrc: true}, (res) => {
    if (!readingVimrc.isRunning) {
      return;
    }
    const [, name, linesInfo] = res.match;
    const [url, content] = readingVimrc.getVimrcFile(name);
    if (!content) {
      if (name != null) {
        res.send(`File not found: ${name}`);
      }
      return;
    }
    const filename = path.basename(url);
    const text = linesInfo.split(/[\s,]+/)
      .map((info) => info.match(/L?(\d+)(?:-L?(\d+))?/))
      .filter((matchResult) => matchResult != null)
      .map((matchResult) => {
        const [startLine, endLine] =
          matchResult
            .slice(1, 3)
            .filter((l) => l != null)
            .map((l) => Number.parseInt(l));
        const lines = readingVimrc.getVimrcLines(content, startLine, endLine);
        if (lines.length === 0) {
          return `無効な範囲です: ${matchResult[0]}`;
        }
        let fragment = `#L${startLine}`;
        if (endLine) {
          fragment += `-L${endLine}`;
        }
        const headUrl = `[${filename}${fragment}](${url}${fragment})`;
        const code = lines.map((line, n) => printf("%4d | %s", n + startLine, line)).join("\n");
        return headUrl + "\n```vim\n" + code + "\n```";
      }).join("\n");
    res.send(text);
  });
  robot.hear(/^!reading_vimrc[\s]+start(?:_reading_vimrc)?$/i, {readingVimrc: true, admin: true}, (res) => {
    getNextYAML(robot).then((nextData) => {
      const link = makeGitterLink(ROOM_NAME, res.envelope.message);
      Promise.all(nextData.vimrcs.map((vimrc) => toGithubLink(vimrc, robot))).then((vimrcs) => {
        readingVimrc.start(nextData.id, link, vimrcs, nextData.part);
        vimrcs.forEach((vimrc) => {
          robot.http(vimrc.raw_link).get()((err, httpRes, body) => {
            readingVimrc.setVimrcContent(vimrc.link, body);
          });
        });
        res.send(readingVimrc.startingMessage(nextData, vimrcs));
      });
    });
  });
  robot.hear(/^!reading_vimrc\s+stop$/, {readingVimrc: true, admin: true}, (res) => {
    readingVimrc.stop();
    if (!readingVimrc.part || readingVimrc.part === "後編") {
      res.send("おつかれさまでした。次回読む vimrc を決めましょう！\nhttps://github.com/vim-jp/reading-vimrc/wiki/Request");
    } else {
      res.send("おつかれさまでした。次回は続きを読むので、どこまで読んだか覚えておきましょう！");
    }
  });
  robot.hear(/^!reading_vimrc\s+reset$/, {readingVimrc: true, admin: true}, (res) => {
    readingVimrc.reset();
    res.send("reset");
  });
  robot.hear(/^!reading_vimrc\s+restore$/, {readingVimrc: true, admin: true}, (res) => {
    readingVimrc.restore();
    res.send("restored");
  });
  robot.hear(/^!reading_vimrc\s+status$/, {readingVimrc: true}, (res) => {
    res.send(readingVimrc.status);
  });
  robot.hear(/^!reading_vimrc\s+members?$/, {readingVimrc: true}, (res) => {
    const members = readingVimrc.members;
    if (members.length === 0) {
      res.send("だれもいませんでした");
    } else {
      const lines = members;
      lines.sort();
      lines.push("\n", readingVimrc.startLink);
      res.send(lines.join("\n"));
    }
  });
  robot.hear(/^!reading_vimrc\s+members?_with_count$/, {readingVimrc: true}, (res) => {
    const messages = readingVimrc.messages;
    if (messages.length === 0) {
      res.send("だれもいませんでした");
    } else {
      const entries = messages
        .map((mes) => mes.user.login)
        .reduce((map, currentValue) => {
          map.set(currentValue, (map.get(currentValue) || 0) + 1);
          return map;
        }, new Map())
        .entries();
      const lines = [...entries]
        .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
        .map(([name, count]) => printf("%03d回 : %s", count, name));
      lines.push("\n", readingVimrc.startLink);
      res.send(lines.join("\n"));
    }
  });
  robot.hear(/^!reading_vimrc\s+help/, {readingVimrc: true}, (res) => {
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
