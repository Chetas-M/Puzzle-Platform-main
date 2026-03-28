import { useEffect, useMemo, useState } from "react";
import {
  bitwiseCalculate,
  caesarShift,
  convertBase,
  frequencyAnalyze,
  fromHexView,
  hashText,
  runEncodingChain,
  subnetDetails,
  toHexView
} from "../utils/toolHelpers";

function UtilityCard({ title, children }) {
  return (
    <article className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
      <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-300">{title}</h4>
      {children}
    </article>
  );
}

export default function ToolsPanel({ toolConfig, onCopy, onExternalLaunch }) {
  const builtins = toolConfig?.builtinUtils || [];
  const externalLinks = toolConfig?.externalLinks || [];
  const hasBuiltins = builtins.length > 0;
  const hasExternalTools = externalLinks.length > 0;

  const [tab, setTab] = useState("built-in");

  const [cipherInput, setCipherInput] = useState("");
  const [cipherShift, setCipherShift] = useState(3);

  const [baseValue, setBaseValue] = useState("");
  const [fromBase, setFromBase] = useState(16);
  const [toBase, setToBase] = useState(10);

  const [chainInput, setChainInput] = useState("");
  const [chainMode, setChainMode] = useState("base64-encode");

  const [freqInput, setFreqInput] = useState("");

  const [hashInput, setHashInput] = useState("");

  const [cidrInput, setCidrInput] = useState("192.168.1.10/24");

  const [bitLeft, setBitLeft] = useState("5");
  const [bitRight, setBitRight] = useState("3");
  const [bitOp, setBitOp] = useState("xor");

  const [hexInput, setHexInput] = useState("");
  const [hexDirection, setHexDirection] = useState("to");

  const enabledBuiltins = useMemo(() => new Set(builtins), [builtins]);

  useEffect(() => {
    if (tab === "built-in" && !hasBuiltins && hasExternalTools) {
      setTab("external");
      return;
    }

    if (tab === "external" && !hasExternalTools && hasBuiltins) {
      setTab("built-in");
    }
  }, [hasBuiltins, hasExternalTools, tab]);

  const results = useMemo(
    () => ({
      cipher: caesarShift(cipherInput, Number(cipherShift)),
      base: convertBase(baseValue, Number(fromBase), Number(toBase)),
      chain: (() => {
        try {
          return runEncodingChain(chainInput, chainMode);
        } catch {
          return "Invalid encoding input";
        }
      })(),
      frequency: frequencyAnalyze(freqInput),
      hash: hashText(hashInput),
      subnet: subnetDetails(cidrInput),
      bitwise: bitwiseCalculate(bitLeft, bitOp, bitRight),
      hex: hexDirection === "to" ? toHexView(hexInput) : fromHexView(hexInput)
    }),
    [
      baseValue,
      bitLeft,
      bitOp,
      bitRight,
      chainInput,
      chainMode,
      cidrInput,
      cipherInput,
      cipherShift,
      fromBase,
      freqInput,
      hashInput,
      hexDirection,
      hexInput,
      toBase
    ]
  );

  return (
    <section className="rounded-2xl border border-slate-700/40 bg-card p-4">
      {!hasBuiltins && !hasExternalTools ? (
        <p className="text-sm text-muted">This puzzle has no configured tools.</p>
      ) : null}

      <div className="mb-3 flex items-center gap-2">
        {hasBuiltins ? (
          <button
            type="button"
            onClick={() => setTab("built-in")}
            className={`rounded-lg px-3 py-2 text-sm ${
              tab === "built-in" ? "bg-accent text-slate-950" : "border border-slate-600"
            }`}
          >
            Built-In Utils
          </button>
        ) : null}
        {hasExternalTools ? (
          <button
            type="button"
            onClick={() => setTab("external")}
            className={`rounded-lg px-3 py-2 text-sm ${
              tab === "external" ? "bg-accent text-slate-950" : "border border-slate-600"
            }`}
          >
            External Tools
          </button>
        ) : null}
      </div>

      {tab === "external" ? (
        <div className="space-y-2">
          {hasExternalTools ? (
            externalLinks.map((link, index) => (
              <button
                key={`${link.url}-${index}`}
                type="button"
                onClick={() => onExternalLaunch?.(link)}
                className="block w-full rounded-lg border border-slate-600/60 bg-slate-900/40 px-3 py-2 text-left text-sm text-sky-300 hover:border-sky-300/60"
              >
                {link.label}
                <span className="ml-2 text-[11px] text-sky-200">{link.download ? "(download)" : "(open)"}</span>
                {link.bypassAntiCheat !== false ? (
                  <span className="ml-2 text-[11px] text-emerald-300">(unrestricted)</span>
                ) : null}
              </button>
            ))
          ) : (
            <p className="text-sm text-muted">No external tools configured for this puzzle.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <div style={{ display: enabledBuiltins.has("cipherDecoder") ? "block" : "none" }}>
            <UtilityCard title="Cipher Decoder">
            <textarea
              className="h-20 w-full rounded-md border border-slate-600 bg-slate-950 p-2"
              placeholder="Encrypted text"
              value={cipherInput}
              onChange={(event) => setCipherInput(event.target.value)}
            />
            <input
              className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 p-2"
              type="number"
              value={cipherShift}
              onChange={(event) => setCipherShift(event.target.value)}
            />
            <button type="button" className="mt-2 rounded-md border px-2 py-1 text-xs" onClick={() => onCopy(results.cipher, "cipherDecoder")}>
              Copy
            </button>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-950/80 p-2 text-xs">{results.cipher}</pre>
            </UtilityCard>
          </div>

          <div style={{ display: enabledBuiltins.has("baseConverter") ? "block" : "none" }}>
            <UtilityCard title="Base Converter">
            <input className="w-full rounded-md border border-slate-600 bg-slate-950 p-2" value={baseValue} onChange={(event) => setBaseValue(event.target.value)} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input className="rounded-md border border-slate-600 bg-slate-950 p-2" type="number" value={fromBase} onChange={(event) => setFromBase(event.target.value)} />
              <input className="rounded-md border border-slate-600 bg-slate-950 p-2" type="number" value={toBase} onChange={(event) => setToBase(event.target.value)} />
            </div>
            <button type="button" className="mt-2 rounded-md border px-2 py-1 text-xs" onClick={() => onCopy(results.base, "baseConverter")}>
              Copy
            </button>
            <pre className="mt-2 rounded-md bg-slate-950/80 p-2 text-xs">{results.base}</pre>
            </UtilityCard>
          </div>

          <div style={{ display: enabledBuiltins.has("encodingChain") ? "block" : "none" }}>
            <UtilityCard title="Encoding Chain">
            <textarea className="h-20 w-full rounded-md border border-slate-600 bg-slate-950 p-2" value={chainInput} onChange={(event) => setChainInput(event.target.value)} />
            <select className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 p-2" value={chainMode} onChange={(event) => setChainMode(event.target.value)}>
              <option value="base64-encode">Base64 Encode</option>
              <option value="base64-decode">Base64 Decode</option>
              <option value="url-encode">URL Encode</option>
              <option value="url-decode">URL Decode</option>
            </select>
            <button type="button" className="mt-2 rounded-md border px-2 py-1 text-xs" onClick={() => onCopy(results.chain, "encodingChain")}>
              Copy
            </button>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-950/80 p-2 text-xs">{results.chain}</pre>
            </UtilityCard>
          </div>

          <div style={{ display: enabledBuiltins.has("frequencyAnalyzer") ? "block" : "none" }}>
            <UtilityCard title="Frequency Analyzer">
            <textarea className="h-20 w-full rounded-md border border-slate-600 bg-slate-950 p-2" value={freqInput} onChange={(event) => setFreqInput(event.target.value)} />
            <button type="button" className="mt-2 rounded-md border px-2 py-1 text-xs" onClick={() => onCopy(results.frequency, "frequencyAnalyzer")}>
              Copy
            </button>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-950/80 p-2 text-xs">{results.frequency}</pre>
            </UtilityCard>
          </div>

          <div style={{ display: enabledBuiltins.has("hashCalculator") ? "block" : "none" }}>
            <UtilityCard title="Hash Calculator">
            <textarea className="h-20 w-full rounded-md border border-slate-600 bg-slate-950 p-2" value={hashInput} onChange={(event) => setHashInput(event.target.value)} />
            <button type="button" className="mt-2 rounded-md border px-2 py-1 text-xs" onClick={() => onCopy(results.hash, "hashCalculator")}>
              Copy
            </button>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-950/80 p-2 text-xs">{results.hash}</pre>
            </UtilityCard>
          </div>

          <div style={{ display: enabledBuiltins.has("subnetCalculator") ? "block" : "none" }}>
            <UtilityCard title="Subnet Calculator">
            <input className="w-full rounded-md border border-slate-600 bg-slate-950 p-2" value={cidrInput} onChange={(event) => setCidrInput(event.target.value)} />
            <button type="button" className="mt-2 rounded-md border px-2 py-1 text-xs" onClick={() => onCopy(results.subnet, "subnetCalculator")}>
              Copy
            </button>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-950/80 p-2 text-xs">{results.subnet}</pre>
            </UtilityCard>
          </div>

          <div style={{ display: enabledBuiltins.has("bitwiseCalculator") ? "block" : "none" }}>
            <UtilityCard title="Bitwise Calculator">
            <div className="grid grid-cols-3 gap-2">
              <input className="rounded-md border border-slate-600 bg-slate-950 p-2" value={bitLeft} onChange={(event) => setBitLeft(event.target.value)} />
              <select className="rounded-md border border-slate-600 bg-slate-950 p-2" value={bitOp} onChange={(event) => setBitOp(event.target.value)}>
                <option value="and">AND</option>
                <option value="or">OR</option>
                <option value="xor">XOR</option>
                <option value="lshift">LShift</option>
                <option value="rshift">RShift</option>
              </select>
              <input className="rounded-md border border-slate-600 bg-slate-950 p-2" value={bitRight} onChange={(event) => setBitRight(event.target.value)} />
            </div>
            <button type="button" className="mt-2 rounded-md border px-2 py-1 text-xs" onClick={() => onCopy(results.bitwise, "bitwiseCalculator")}>
              Copy
            </button>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-950/80 p-2 text-xs">{results.bitwise}</pre>
            </UtilityCard>
          </div>

          <div style={{ display: enabledBuiltins.has("hexViewer") ? "block" : "none" }}>
            <UtilityCard title="Hex Viewer">
            <textarea className="h-20 w-full rounded-md border border-slate-600 bg-slate-950 p-2" value={hexInput} onChange={(event) => setHexInput(event.target.value)} />
            <select className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950 p-2" value={hexDirection} onChange={(event) => setHexDirection(event.target.value)}>
              <option value="to">Text to Hex</option>
              <option value="from">Hex to Text</option>
            </select>
            <button type="button" className="mt-2 rounded-md border px-2 py-1 text-xs" onClick={() => onCopy(results.hex, "hexViewer")}>
              Copy
            </button>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-950/80 p-2 text-xs">{results.hex}</pre>
            </UtilityCard>
          </div>
        </div>
      )}
    </section>
  );
}
