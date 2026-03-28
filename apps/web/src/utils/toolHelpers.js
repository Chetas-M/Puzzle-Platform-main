import { sha256 } from "js-sha256";

export function caesarShift(input, shift = 3) {
  const amount = Number(shift) % 26;
  return [...`${input}`]
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code >= 65 && code <= 90) {
        return String.fromCharCode(((code - 65 - amount + 26) % 26) + 65);
      }
      if (code >= 97 && code <= 122) {
        return String.fromCharCode(((code - 97 - amount + 26) % 26) + 97);
      }
      return char;
    })
    .join("");
}

export function convertBase(value, fromBase, toBase) {
  const parsed = Number.parseInt(`${value}`.trim(), Number(fromBase));
  if (Number.isNaN(parsed)) {
    return "Invalid number for selected base.";
  }
  return parsed.toString(Number(toBase));
}

export function runEncodingChain(input, mode) {
  if (mode === "base64-encode") {
    return btoa(unescape(encodeURIComponent(input)));
  }
  if (mode === "base64-decode") {
    return decodeURIComponent(escape(atob(input)));
  }
  if (mode === "url-encode") {
    return encodeURIComponent(input);
  }
  if (mode === "url-decode") {
    return decodeURIComponent(input);
  }
  return input;
}

export function frequencyAnalyze(input) {
  const map = new Map();
  for (const char of `${input}`.toLowerCase()) {
    if (!char.trim()) continue;
    map.set(char, (map.get(char) || 0) + 1);
  }

  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([char, count]) => `${char}: ${count}`)
    .join("\n");
}

export function hashText(input, algorithm = "sha256") {
  if (algorithm === "sha256") {
    return sha256(input);
  }
  return "Unsupported algorithm";
}

export function subnetDetails(cidr) {
  const [ip, prefixRaw] = `${cidr}`.split("/");
  const prefix = Number(prefixRaw);
  if (!ip || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    return "Invalid CIDR";
  }

  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return "Invalid IPv4 address";
  }

  const ipInt =
    ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipInt & mask;
  const broadcast = network | (~mask >>> 0);
  const hosts = prefix >= 31 ? 0 : broadcast - network - 1;

  const intToIp = (n) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");

  return `network: ${intToIp(network)}\nbroadcast: ${intToIp(broadcast)}\nhosts: ${hosts}`;
}

export function bitwiseCalculate(left, op, right) {
  const a = Number(left);
  const b = Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return "Invalid numbers";
  }

  const operations = {
    and: a & b,
    or: a | b,
    xor: a ^ b,
    lshift: a << b,
    rshift: a >> b
  };

  if (!(op in operations)) {
    return "Invalid operation";
  }

  return `${operations[op]} (0b${(operations[op] >>> 0).toString(2)})`;
}

export function toHexView(input) {
  return [...`${input}`]
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join(" ");
}

export function fromHexView(hex) {
  const cleaned = `${hex}`.replace(/\s+/g, "").toLowerCase();
  if (cleaned.length % 2 !== 0 || /[^0-9a-f]/.test(cleaned)) {
    return "Invalid hex input";
  }

  let output = "";
  for (let i = 0; i < cleaned.length; i += 2) {
    output += String.fromCharCode(Number.parseInt(cleaned.slice(i, i + 2), 16));
  }

  return output;
}
