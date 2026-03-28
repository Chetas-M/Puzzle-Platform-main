import fs from "node:fs";
import path from "node:path";

function hintSet(topic) {
  return [
    {
      tier: "tier1",
      content: `Start with the most direct clue in the ${topic} files.`,
      penaltySeconds: 60
    },
    {
      tier: "tier2",
      content: "Use provided helper scripts or references to validate intermediate output.",
      penaltySeconds: 120
    },
    {
      tier: "tier3",
      content: "Submit in the exact expected format and casing shown in the puzzle notes.",
      penaltySeconds: 180
    }
  ];
}

function normalizeText(value) {
  return `${value || ""}`.replace(/\r/g, "").trim();
}

function readFirstLine(filePath, fallback = "") {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  const text = normalizeText(fs.readFileSync(filePath, "utf8"));
  if (!text) {
    return fallback;
  }

  const first = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  return first || fallback;
}

function main() {
  const sourceRoot = process.argv[2];
  if (!sourceRoot) {
    console.error("Usage: node apps/api/scripts/import_external_folder.mjs <source-folder>");
    process.exit(1);
  }

  const resolvedSource = path.resolve(sourceRoot);
  if (!fs.existsSync(resolvedSource)) {
    console.error(`Source folder not found: ${resolvedSource}`);
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const puzzleBankDir = path.resolve(repoRoot, "apps/api/puzzle_bank");
  const importedDir = path.join(puzzleBankDir, "imported", path.basename(resolvedSource));
  const puzzlesJsonPath = path.join(puzzleBankDir, "puzzles.json");

  fs.rmSync(importedDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(importedDir), { recursive: true });
  fs.cpSync(resolvedSource, importedDir, { recursive: true });

  const asciiAnswer = readFirstLine(path.join(resolvedSource, "ascii_numeric_sample", "organizer_solution.txt"), "COSC 7989");
  const htmlAnswerRaw = readFirstLine(path.join(resolvedSource, "html_inspect_sample", "organizer_solution.txt"), "HIDDENKEY: PHOENIX");
  const htmlAnswer = htmlAnswerRaw.includes(":") ? htmlAnswerRaw.split(":").slice(1).join(":").trim() : htmlAnswerRaw;
  const otpAnswer = readFirstLine(path.join(resolvedSource, "TimeBasedOTP_Puzzle", "answer.txt"), "PUZZLE");
  const mazeMoves = normalizeText(
    fs.existsSync(path.join(resolvedSource, "maze_300_moves", "maze-puzzle(1)", "moves.txt"))
      ? fs.readFileSync(path.join(resolvedSource, "maze_300_moves", "maze-puzzle(1)", "moves.txt"), "utf8")
      : ""
  ).replace(/\s+/g, "");

  const puzzles = [
    {
      slug: "http-error-chain",
      title: "HTTP Error Chain",
      type: "web_http",
      answerKey: "418",
      prompt:
        "Trigger intentional HTTP status codes by making one targeted link edit. Final submission is the finale code from the chain.",
      builtinUtils: ["encodingChain", "hexViewer"],
      externalLinks: [{ label: "HTTP Status Reference", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Status" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("HTTP error chain")
    },
    {
      slug: "ascii-numeric-sample",
      title: "ASCII Numeric Decode",
      type: "ascii_numeric",
      answerKey: asciiAnswer,
      prompt: "Decode ASCII-based numeric clues from the provided puzzle text files and submit the final key.",
      builtinUtils: ["baseConverter", "encodingChain", "hexViewer"],
      externalLinks: [{ label: "ASCII Table", url: "https://www.asciitable.com/" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("ASCII puzzle")
    },
    {
      slug: "audio-morse-sample",
      title: "Audio Morse",
      type: "audio_morse",
      answerKey: "HELP",
      prompt: "Decode the morse audio pulse timings to recover the hidden word.",
      builtinUtils: ["cipherDecoder", "frequencyAnalyzer"],
      externalLinks: [{ label: "Morse Reference", url: "https://morsecode.world/international/translator.html" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("audio morse")
    },
    {
      slug: "book-cipher-puzzle",
      title: "Book Cipher",
      type: "book_cipher",
      answerKey: "CLUE",
      prompt: "Use coordinate references against the book text to reconstruct the hidden keyword.",
      builtinUtils: ["cipherDecoder", "baseConverter"],
      externalLinks: [{ label: "Character Counter", url: "https://www.charactercountonline.com/" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("book cipher")
    },
    {
      slug: "fix-errors-participant-pack",
      title: "Fix Errors Participant",
      type: "fix_errors",
      answerKey: "TREASURE",
      prompt: "Repair the buggy script and decode the binary payload to recover the final word.",
      builtinUtils: ["hashCalculator", "bitwiseCalculator"],
      externalLinks: [{ label: "Python Docs", url: "https://docs.python.org/3/" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("bug-fix participant")
    },
    {
      slug: "fix-errors-organizer-pack",
      title: "Fix Errors Organizer",
      type: "fix_errors",
      answerKey: "TREASURE",
      prompt: "Use organizer pack references to verify repaired logic and confirm the decoded secret word.",
      builtinUtils: ["hashCalculator", "bitwiseCalculator"],
      externalLinks: [{ label: "Python Docs", url: "https://docs.python.org/3/" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("bug-fix organizer")
    },
    {
      slug: "html-inspect-sample",
      title: "HTML Inspect",
      type: "html_inspect",
      answerKey: htmlAnswer || "PHOENIX",
      prompt: "Inspect DOM/comments and hidden HTML sections to locate the embedded key.",
      builtinUtils: ["hexViewer", "encodingChain"],
      externalLinks: [{ label: "HTML Inspector Guide", url: "https://developer.mozilla.org/en-US/docs/Learn/Tools_and_testing/Cross_browser_testing/Your_own_automation_environment" }],
      isInspectPuzzle: true,
      isolatedUrl: "/challenge/html-inspect-sample",
      hints: hintSet("HTML inspect")
    },
    {
      slug: "image-cipher",
      title: "Image Cipher",
      type: "image_cipher",
      answerKey: "KEY",
      prompt: "Adjust image properties to reveal hidden text from visual layers and submit the recovered key word.",
      builtinUtils: ["frequencyAnalyzer", "encodingChain"],
      externalLinks: [{ label: "Photopea", url: "https://www.photopea.com/" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("image cipher")
    },
    {
      slug: "maze-300-moves",
      title: "Maze 300 Moves",
      type: "maze",
      answerKey: mazeMoves || "R,R,D,D",
      prompt: "Find the correct movement route through the maze and submit the full move sequence.",
      builtinUtils: ["encodingChain", "baseConverter"],
      externalLinks: [{ label: "Regex101", url: "https://regex101.com/" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("maze route")
    },
    {
      slug: "progressive-caesar-1",
      title: "Progressive Caesar I",
      type: "caesar",
      answerKey: "HIDE THE KEY",
      prompt: "Decrypt the progressive Caesar ciphertext where shift increments by character position.",
      builtinUtils: ["cipherDecoder", "frequencyAnalyzer"],
      externalLinks: [{ label: "dCode Caesar", url: "https://www.dcode.fr/caesar-cipher" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("progressive caesar")
    },
    {
      slug: "progressive-caesar-2",
      title: "Progressive Caesar II",
      type: "caesar",
      answerKey: "DAWN BREAKS SOON",
      prompt: "Continue the progressive Caesar sequence and decode the second encrypted message.",
      builtinUtils: ["cipherDecoder", "frequencyAnalyzer"],
      externalLinks: [{ label: "dCode Caesar", url: "https://www.dcode.fr/caesar-cipher" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("progressive caesar")
    },
    {
      slug: "simple-reverse-text",
      title: "Simple Reverse Text",
      type: "reverse",
      answerKey: "CODEFEST25",
      prompt: "Reverse and reconstruct all lines to derive the final assembled event code.",
      builtinUtils: ["encodingChain", "hexViewer"],
      externalLinks: [{ label: "Text Reverse Tool", url: "https://www.browserling.com/tools/reverse-text" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("reverse text")
    },
    {
      slug: "time-based-otp",
      title: "Time Based OTP",
      type: "otp",
      answerKey: otpAnswer,
      prompt: "Use dial clues and puzzle spec artifacts to reconstruct the final word.",
      builtinUtils: ["hashCalculator", "baseConverter"],
      externalLinks: [{ label: "RFC 6238", url: "https://datatracker.ietf.org/doc/html/rfc6238" }],
      isInspectPuzzle: false,
      isolatedUrl: null,
      hints: hintSet("OTP puzzle")
    }
  ];

  fs.writeFileSync(puzzlesJsonPath, `${JSON.stringify(puzzles, null, 2)}\n`, "utf8");

  console.log(`Imported source copied to: ${importedDir}`);
  console.log(`Updated puzzle bank: ${puzzlesJsonPath}`);
  console.log(`Puzzle count: ${puzzles.length}`);
}

main();
