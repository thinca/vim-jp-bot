// Description:
//   Supports reading vimrc.
//   https://vim-jp.org/reading-vimrc/
//
// Dependencies:
//   js-yaml: 3.6.0
//   printf: 0.2.3
//
// Configuration:
//   HUBOT_READING_VIMRC_ENABLE
//     Set non-empty value to enable this script.
//   HUBOT_READING_VIMRC_ROOM_NAME
//     Target room name.
//     This script works only on the specified room.
//   HUBOT_READING_VIMRC_ADMIN_USERS
//     Admin users.  This is comma separated list.
//     Some commands can be executed by admin users only.
//   HUBOT_READING_VIMRC_HOMEPAGE
//     Site URL of reading vimrc.
//     This must end with "/".
//   HUBOT_READING_VIMRC_GITHUB_REPOS
//     Git repository of reading-vimrc gh-pages. (Like "vim-jp/reading-vimrc")
//   HUBOT_READING_VIMRC_WORK_DIR
//     Working directory.
//     This script can update the reading vimrc sites on GitHub Pages.
//   HUBOT_READING_VIMRC_GITHUB_API_TOKEN
//     GitHub API token to register ssh key to GitHub.
//     write:public_key scope is needed.
//   HUBOT_READING_VIMRC_GITTER_ACTIVITY_HOOK_URL
//     URL to update gitter activity.
//
// Commands:
//   !reading_vimrc start - Start the reading vimrc.  Admin only.
//   !reading_vimrc stop - Stop the reading vimrc.  Admin only.
//   !reading_vimrc reset - Reset the members of current reading vimrc.  Admin only.
//   !reading_vimrc restore - Restore the members.
//   !reading_vimrc status - Show the status(started or stopped).
//   !reading_vimrc member - List the members of current reading vimrc.
//   !reading_vimrc member_with_count - List of members with said count.
//   !reading_vimrc next {vimrc} ... - Update next vimrc.
//   !reading_vimrc request[!] {vimrc} - Add a vimrc to request page.
//   !reading_vimrc help - Show the help.
//
// Author:
//   thinca <thinca+npm@gmail.com>

if (!process.env.HUBOT_READING_VIMRC_ENABLE) {
  module.exports = () => {};
  return;
}

const path = require("path");
const {URL} = require("url");
const printf = require("printf");

const ReadingVimrc = require("../lib/reading_vimrc");
const ReadingVimrcRepos = require("../lib/reading_vimrc_repos");

const ROOM_NAME = process.env.HUBOT_READING_VIMRC_ROOM_NAME || "vim-jp/reading-vimrc";
const ADMIN_USERS = (process.env.HUBOT_READING_VIMRC_ADMIN_USERS || "").split(/,/);
const HOMEPAGE_BASE = process.env.HUBOT_READING_VIMRC_HOMEPAGE || "https://vim-jp.org/reading-vimrc/";
const GITTER_HOOK = process.env.HUBOT_READING_VIMRC_GITTER_ACTIVITY_HOOK_URL;

const REQUEST_PAGE = "https://github.com/vim-jp/reading-vimrc/wiki/Request";

const helpMessage = `vimrc読書会サポート bot です

!reading_vimrc {command} [{args}...]

start         : 会の開始、"member" は "reset" される(owner)
stop          : 会の終了(owner)
reset         : "member" をリセット(owner)
restore       : "member" を1つ前に戻す(owner)
status        : ステータスの出力
member        : "start" ～ "stop" の間に発言した人を列挙
member_with_count : "member" に発言数も追加して列挙
next {url}... : 次回分更新(owner)
request[!] {url}... : 読みたい vimrc をリクエストページに追加
help          : 使い方を出力`;

const createStartingMessage = (data, vimrcs) => {
  return `=== 第${data.id}回 vimrc読書会 ===
- 途中参加/途中離脱OK。声をかける必要はありません
- 読む順はとくに決めないので、好きなように読んで好きなように発言しましょう
- vimrc 内の特定位置を参照する場合は行番号で L100 や L100-110 のように指定します${
  1 < vimrcs.length ? `
- 今回は複数ファイルがあるため、filename#L100 のようにファイル名を指定します
- 省略した場合は直前に参照しファイルか、それがない場合は適当なファイルになります` : ""
    }
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
${createSumaryMessage(data, vimrcs)}`;
};

const createActivityMessage = (data, vimrcs) => {
  return `=== 第${data.id}回 vimrc読書会 ===
${createSumaryMessage(data, vimrcs)}`;
};

const createSumaryMessage = (data, vimrcs) => {
  return `今回読む vimrc: [${data.author.name}](${data.author.url}) さん:${
    vimrcs.map((vimrc) => `
[${vimrc.name}](${vimrc.url}) ([DL](${vimrc.raw_url}))`
    ).join("")
  }`;
};

const generateResultData = async (readingVimrcRepos, readingVimrc) => {
  const nextData = await readingVimrcRepos.readNextYAMLData();
  if (nextData.id === readingVimrc.id) {
    nextData.members = readingVimrc.members.sort();
    nextData.log = readingVimrc.logURL;
    nextData.vimrcs = readingVimrc.vimrcs.map((vimrc) => Object.assign({}, vimrc));
  }
  return nextData;
};

const lastCommitHash = (() => {
  // XXX: Should cache expire?
  const hashes = new Map();
  return (url, robot) => {
    const [, place] = url.match(/https:\/\/github\.com\/([^/]+\/[^/]+)/);
    // XXX Should `hashes` lock? How?
    if (hashes.has(place)) {
      return hashes.get(place);
    }
    const apiURL = `https://api.github.com/repos/${place}/commits/HEAD`;
    const p = new Promise((resolve, reject) => {
      robot.http(apiURL)
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

const makeGitterURL = (room, message) => {
  return `https://gitter.im/${room}?at=${message.id}`;
};

const isAdmin = (user) => {
  return ADMIN_USERS.includes(user.login || user.name);  // user.name for shell adapter
};

const PLUGIN_REPO_PATTERN =
  /^\s*(?:"\s*)?(?:Plug(?:in)?|NeoBundle\w+|call\s+(?:dein|minpac)#add\()\s*['"]([^'"]+)/gm;
const extractPluginURLs = (text) => {
  const repos = [];
  let result;
  while((result = PLUGIN_REPO_PATTERN.exec(text)) !== null) {
    repos.push(result[1]);
  }
  const repoURLs = repos.map((repo) => {
    let url = repo;
    if (!url.includes("/")) {
      url = `vim-scripts/${url}`;
    }
    if (/^[^/]+\/[^/]+$/.test(url)) {
      url = `https://github.com/${url}`;
    }
    return {repo, url};
  });
  return repoURLs;
};

module.exports = (robot) => {
  const toFixedVimrc = async (vimrc) => {
    const hash = vimrc.hash || await lastCommitHash(vimrc.url, robot);
    vimrc.hash = hash;
    const url = vimrc.url.replace(/blob\/\w+\//, `blob/${hash}/`);
    const raw_url = vimrc.url
      .replace(/https:\/\/github/, "https://raw.githubusercontent")
      .replace(/blob\/[^/]+\//, `${hash}/`);
    return {name: vimrc.name, url, raw_url, hash};
  };

  let readingVimrcRepos;
  (async () => {
    const githubRepos = process.env.HUBOT_READING_VIMRC_GITHUB_REPOS;
    const workDir = process.env.HUBOT_READING_VIMRC_WORK_DIR;
    const apiToken = process.env.HUBOT_READING_VIMRC_GITHUB_API_TOKEN;
    if (!githubRepos || !workDir || !apiToken) {
      return;
    }
    const repos = new ReadingVimrcRepos(githubRepos, workDir, apiToken);
    try {
      await repos.setup();
      readingVimrcRepos = repos;
      robot.logger.info("ReadingVimrcRepos: setup succeeded.");
    } catch (e) {
      robot.logger.error("ReadingVimrcRepos: setup failed.", e);
    }
  })();

  const readingVimrc = new ReadingVimrc();
  let targetRoomId = "Shell";  // for shell adapter on debug
  if (robot.adapterName === "gitter2") {
    robot.adapter._resolveRoom(ROOM_NAME, (room) => {
      targetRoomId = room.id();
      robot.logger.info("targetRoomId updated: ", targetRoomId, ROOM_NAME);
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
      robot.logger.warning(
        "A non admin user tried to use an admin command: %s: %s",
        user.login || user.name,
        context.response.message.text
      );
      done();
      return;
    }
    next();
  });
  robot.hear(/.*/i, {readingVimrc: true}, (res) => {
    if (!(/^!reading_vimrc/.test(res.message.text))) {
      readingVimrc.addMessage(res.message);
    }
  });
  robot.hear(/^(?:(\S+)#)??(L\d+(?:[-+]L?\d+)?(?:(?:\s+L|,L?)\d+(?:[-+]L?\d+)?)*)/, {readingVimrc: true}, (res) => {
    if (!readingVimrc.isRunning) {
      return;
    }
    const [, name, linesInfo] = res.match;
    const username = res.envelope.user.login || res.envelope.user.name;
    const [url, content] = readingVimrc.getVimrcFile(name, username);
    if (!content) {
      if (name != null) {
        res.send(`File not found: ${name}`);
      }
      return;
    }
    const filename = path.basename(url);
    const text = linesInfo.split(/[\s,]+/)
      .map((info) => info.match(/L?(\d+)(?:([-+])L?(\d+))?/))
      .filter((matchResult) => matchResult != null)
      .map((matchResult) => {
        const startLine = Number.parseInt(matchResult[1]);
        const flag = matchResult[2];
        const secondNum = matchResult[3] ? Number.parseInt(matchResult[3]) : undefined;
        const endLine = flag === "+" ? startLine + secondNum : secondNum;
        const lines = readingVimrc.getVimrcLines(content, startLine, endLine);
        if (lines.length === 0) {
          return `無効な範囲です: ${matchResult[0]}`;
        }
        let fragment = `#L${startLine}`;
        if (endLine) {
          fragment += `-L${endLine}`;
        }
        const headURL = `[${filename}${fragment}](${url}${fragment})`;
        const code = lines.map((line, n) => printf("%4d | %s", n + startLine, line)).join("\n");
        const repoURLs = extractPluginURLs(lines.join("\n")).map(({repo, url}) => `[${repo}](${url})`);
        return [
          headURL,
          "```vim",
          code,
          "```",
        ].concat(repoURLs).join("\n");
      }).join("\n");
    res.send(text);
  });
  robot.hear(/^!reading_vimrc[\s]+start$/i, {readingVimrc: true, admin: true}, async (res) => {
    const nextData = await readingVimrcRepos.readNextYAMLData();
    const logURL = makeGitterURL(ROOM_NAME, res.envelope.message);
    const vimrcs = await Promise.all(nextData.vimrcs.map(toFixedVimrc));
    readingVimrc.start(nextData.id, logURL, vimrcs, nextData.part);
    vimrcs.forEach((vimrc) => {
      robot.http(vimrc.raw_url).get()((err, httpRes, body) => {
        readingVimrc.setVimrcContent(vimrc.url, body);
      });
    });
    res.send(createStartingMessage(nextData, vimrcs));
    if (GITTER_HOOK) {
      const activity = createActivityMessage(nextData, vimrcs);
      const data = JSON.stringify({message: activity});
      const options = {
        headers: {"Content-Type": "application/json"},
      };
      robot.logger.info("Update Gitter Activity:", GITTER_HOOK);
      robot.logger.info("POST DATA:", data);
      robot.http(GITTER_HOOK, options).post(data)((err, httpRes, body) => {
        if (err) {
          robot.logger.error("POST activity failed:", err, body);
        } else {
          robot.logger.info("POST activity succeeded:", body);
        }
      });
    }
  });
  robot.hear(/^!reading_vimrc\s+stop$/, {readingVimrc: true, admin: true}, async (res) => {
    readingVimrc.stop();
    if (!readingVimrc.part || readingVimrc.part === "後編") {
      res.send(`おつかれさまでした。次回読む vimrc を決めましょう！\n${REQUEST_PAGE}`);
    } else {
      res.send("おつかれさまでした。次回は続きを読むので、どこまで読んだか覚えておきましょう！");
    }
    if (readingVimrcRepos) {
      try {
        const resultData = await generateResultData(readingVimrcRepos, readingVimrc);
        await readingVimrcRepos.finish(resultData);
        const id = resultData.id;
        const url = `${HOMEPAGE_BASE}archive/${printf("%03d", id)}.html`;
        res.send(`アーカイブページを更新しました: [第${id}回](${url})`);
      } catch (error) {
        res.send(`ERROR: ${error}`);
        res.send(error);
        robot.logger.error("Error occurred while updating a result:", error);
      }
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
      lines.push("\n", readingVimrc.logURL);
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
      lines.push("\n", readingVimrc.logURL);
      res.send(lines.join("\n"));
    }
  });
  robot.hear(/^!reading_vimrc\s+next\s+([^]+)/, {readingVimrc: true, admin: true}, async (res) => {
    if (!readingVimrcRepos) {
      return;
    }
    try {
      const urls = res.match[1].split(/\s+/);
      const resultData = await generateResultData(readingVimrcRepos, readingVimrc);
      const nextData = await readingVimrcRepos.next(urls, resultData);
      res.send(`次回予告を更新しました:\n次回 第${nextData.id}回 ${nextData.date} [${nextData.author.name}](${nextData.author.url}) さん`);
    } catch (error) {
      res.send(`ERROR: ${error}`);
      robot.logger.error("Error occurred while updating a result:", error);
    }
  });
  robot.hear(/^!reading_vimrc\s+request(!?)\s+(\S+)(?:\s+([^]+))?/, {readingVimrc: true}, async (res) => {
    if (!readingVimrcRepos) {
      return;
    }
    const update = async () => {
      try {
        const updated = await readingVimrcRepos.addWikiEntry(requester, author, url, comment);
        if (updated) {
          res.send(`vimrc を[リクエストページ](${REQUEST_PAGE})に追加しました`);
        } else {
          res.send(`何らかの理由により、[リクエストページ](${REQUEST_PAGE})は更新されませんでした`);
        }
      } catch (error) {
        res.send(`ERROR: ${error}`);
        robot.logger.error("Error occurred while updating a result:", error);
      }
    };

    const force = res.match[1] === "!";

    const [, , url, comment] = res.match;
    const requester = res.envelope.user.name;
    const author = new URL(url).pathname.split("/")[1];

    if (force) {
      await update();
      return;
    }

    const memberSet = await readingVimrcRepos.readTargetMembers();
    if (memberSet.has(author)) {
      res.send(`${author} さんの vimrc は過去に読まれています。\n再リクエストの場合は request! を使ってください`);
    } else {
      await update();
    }
  });
  robot.hear(/^!reading_vimrc\s+help/, {readingVimrc: true}, (res) => {
    res.send(helpMessage);
  });
};
