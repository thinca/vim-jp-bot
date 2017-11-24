class ReadingVimrc {
  constructor() {
    this.id = 0;
    this.startLink = "";
    this.messages = [];
    this.vimrcs = [];
    this.isRunning = false;
    this.vimrcContents = new Map();
    this.vimrcLastname = new Map();
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

  getVimrcFile(namePat, username) {
    const names = [...this.vimrcContents.keys()];
    let name;
    if (namePat) {
      name = [
        `^${namePat}$`,
        `/${namePat}(?:\\..*)?$`,
        namePat,
      ].reduce((k, pat) => {
        if (!k) {
          const reg = new RegExp(pat, "i");
          k = names.find((k) => reg.test(k));
        }
        return k;
      }, null);
    } else if (this.vimrcLastname.has(username)) {
      name = this.vimrcLastname.get(username);
    } else {
      name = names[0];
    }
    if (!this.vimrcContents.has(name)) {
      return [];
    }
    if (username) {
      this.vimrcLastname.set(username, name);
    }
    return [name, this.vimrcContents.get(name)];
  }

  getVimrcLines(content, startLine, endLine = startLine) {
    return content.slice(startLine - 1, endLine);
  }

  clearVimrcs() {
    this.vimrcContents.clear();
    this.vimrcLastname.clear();
  }
}

module.exports = ReadingVimrc;
