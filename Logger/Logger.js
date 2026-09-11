import { ENABLE_INCOMING } from "../config.js";

const ignorePackets = [];

class Logger {
  constructor(Nickname) {
    this.enableIncoming = true;
    this.enableOutgoing = true;
    this.enableBasicIncoming = true;
    this.enableBasicOutgoing = true;
    this.enableInfo = true;
    this.enableError = true;
    this.enableWarning = true;
    this.ioEmit = true;
    this.ioEvent = true;
    this.Nickname = Nickname;
    this.viewSpaces = ["100072911"];
    this.idColors = {
      100045260: "\x1b[36m", // Cyan
      100119080: "\x1b[35m", // Green (swapped with cyan)
      100045720: "\x1b[34m", // Blue
      100072911: "\x1b[37m", // Yellow (swapped with magenta)
    };
  }

  incomingPackets(...args) {
    const packetInfo = args[0];
    const packetID = packetInfo.split("Packet Id: ")[1].split(" ")[0];
    if (this.enableIncoming && !ignorePackets.includes(packetID)) {
      console.log(new Date(), "\x1b[31m", `[INCOMING - ${this.Nickname}]`, ...args, "\x1b[0m");
    }
  }

  loggerIoEvent(event, listener, io) {
    if (!this.ioEvent) return;
    io.on(event, listener);
  }

  loggerIoEventOff(event, listener, io) {
    if (!this.ioEvent) return;
    io.off(event, listener);
  }

  loggerIoEmit(channel, args, io) {
    if (!this.ioEmit) return;
    io.emit(channel, args);
  }

  outgoingPackets(...args) {
    if (this.enableOutgoing) {
      console.log(new Date(), "\x1b[32m", `[OUTGOING  - ${this.Nickname}]`, ...args, "\x1b[0m");
    }
  }

  error(...args) {
    if (this.enableError) {
      console.error("\x1b[31m", `[  ERROR - ${this.Nickname} ]`, ...args, "\x1b[0m");
    }
  }

  basicIncomingPackets(...args) {
    if (this.enableBasicIncoming) {
      const packet = args.join(" ");
      const idRegex = /(?<=\[)\d+(?=\s-\sSV_)/; // Updated regular expression
      const idMatch = packet.match(idRegex);
      const id = idMatch ? idMatch[0] : null;

      if (id && this.idColors[id]) {
        const color = this.idColors[id];
        console.log(new Date(), "\x1b[31m", `[INCOMING - ${this.Nickname}]`, "\x1b[0m", color, ...args, "\x1b[0m");
      } else {
        console.log(new Date(), "\x1b[31m", `[INCOMING - ${this.Nickname}]`, "\x1b[0m", ...args);
      }
    }
  }

  basicOutgoingPackets(packet) {
    if (this.enableBasicOutgoing) {
      const idRegex = /(?<=\[)\d+(?=\s-\sCL_)/; // Regular expression for outgoing packets
      const idMatch = packet.match(idRegex);
      const id = idMatch ? idMatch[0] : null;

      if (id && this.idColors[id]) {
        const color = this.idColors[id];
        console.log(new Date(), "\x1b[32m", `[OUTGOING  - ${this.Nickname}]`, "\x1b[0m", color, packet, "\x1b[0m");
      } else {
        console.log(new Date(), "\x1b[32m", `[OUTGOING  - ${this.Nickname}]`, "\x1b[0m", packet);
      }
    }
  }

  info(...args) {
    if (this.enableInfo) {
      console.log(new Date(), "\x1b[33m", `[  INFO  - ${this.Nickname}] `, ...args, "\x1b[0m");
    }
  }

  success(...args) {
    if (this.enableInfo) {
      console.log(new Date(), "\x1b[32m", `[ SUCCESS - ${this.Nickname}] `, ...args, "\x1b[0m");
    }
  }
}

export default Logger;
