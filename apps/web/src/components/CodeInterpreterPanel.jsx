import { useEffect, useMemo, useState } from "react";
import api from "../services/api";

const REFERENCE_TEXT_EXTENSIONS = new Set([
  ".py",
  ".js",
  ".ts",
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".csv",
  ".html",
  ".css"
]);

const CHECKER_NAME_TOKENS = ["solution", "organizer_solution", "verifier", "correct", "answer"];

function inferAssetRole(assetItem) {
  const explicitRole = `${assetItem?.role || ""}`.toLowerCase();
  if (explicitRole === "reference" || explicitRole === "solution") {
    return explicitRole;
  }

  const name = `${assetItem?.name || ""}`.toLowerCase();
  if (name.startsWith("reference-")) {
    return "reference";
  }
  if (name.startsWith("solution-")) {
    return "solution";
  }
  if (CHECKER_NAME_TOKENS.some((token) => name.includes(token))) {
    return "solution";
  }

  return "regular";
}

function isReferenceTextAsset(assetItem) {
  const name = `${assetItem?.name || ""}`.toLowerCase();
  const dotIndex = name.lastIndexOf(".");
  const extension = dotIndex >= 0 ? name.slice(dotIndex) : "";
  return REFERENCE_TEXT_EXTENSIONS.has(extension);
}

function defaultSnippet(language) {
  if (language === "javascript") {
    return "const input = \"hello\";\nconsole.log(input.toUpperCase());";
  }

  return "text = \"hello\"\nprint(text.upper())";
}

export default function CodeInterpreterPanel({
  puzzleId,
  puzzleType,
  toolConfig,
  assetItems = [],
  disabled = false
}) {
  const referenceAssets = useMemo(() => {
    const rows = assetItems
      .filter((item) => item?.url)
      .filter((item) => inferAssetRole(item) !== "solution")
      .filter((item) => isReferenceTextAsset(item));

    return [...rows].sort((left, right) => {
      const leftPriority = inferAssetRole(left) === "reference" ? 0 : 1;
      const rightPriority = inferAssetRole(right) === "reference" ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return `${left?.name || ""}`.localeCompare(`${right?.name || ""}`);
    });
  }, [assetItems]);
  const pythonReferenceAssets = useMemo(
    () => referenceAssets.filter((item) => `${item?.name || ""}`.toLowerCase().endsWith(".py")),
    [referenceAssets]
  );
  const builtins = toolConfig?.builtinUtils || [];
  const interpreterEnabled =
    builtins.includes("codeWorkspace") || builtins.includes("pythonInterpreter") || builtins.includes("codeVerifier");
  const verifierEnabled = builtins.includes("codeVerifier");

  const preferredLanguage = useMemo(() => {
    const hasPythonAsset = pythonReferenceAssets.length > 0;
    const type = `${puzzleType || ""}`.toLowerCase();
    if (builtins.includes("pythonInterpreter") || hasPythonAsset || type.includes("fix") || type.includes("python")) {
      return "python";
    }
    return "javascript";
  }, [builtins, pythonReferenceAssets, puzzleType]);

  const enforcePython = preferredLanguage === "python";

  const [language, setLanguage] = useState(preferredLanguage);
  const [code, setCode] = useState(defaultSnippet(preferredLanguage));
  const [stdin, setStdin] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [checkMessage, setCheckMessage] = useState("");
  const [referenceAssetUrl, setReferenceAssetUrl] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const [referenceLoading, setReferenceLoading] = useState(false);

  useEffect(() => {
    setLanguage(preferredLanguage);
    setCode(defaultSnippet(preferredLanguage));
    setStdin("");
    setResult(null);
    setCheckMessage("");
    setReferenceAssetUrl(referenceAssets[0]?.url || "");
  }, [preferredLanguage, puzzleId, referenceAssets]);

  useEffect(() => {
    const match = referenceAssets.find((item) => item.url === referenceAssetUrl);
    if (!match?.url) {
      setReferenceCode("");
      setReferenceLoading(false);
      return;
    }

    let cancelled = false;
    setReferenceLoading(true);

    api
      .get(match.url, {
        responseType: "text",
        transformResponse: [(value) => value]
      })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const next = `${response?.data || ""}`;
        setReferenceCode(next);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setReferenceCode("Unable to load reference code file.");
      })
      .finally(() => {
        if (!cancelled) {
          setReferenceLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [referenceAssets, referenceAssetUrl]);

  const runSnippet = async () => {
    if (!puzzleId || disabled || isRunning) {
      return;
    }

    setIsRunning(true);
    setCheckMessage("");
    try {
      const response = await api.post(`/puzzles/${puzzleId}/interpreter/run`, {
        language,
        code,
        stdin
      });
      setResult(response.data);
    } catch (requestError) {
      setResult({
        ok: false,
        runtimeError: requestError?.response?.data?.message || "Interpreter execution failed.",
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false
      });
    } finally {
      setIsRunning(false);
    }
  };

  const runAndCheckAnswer = async () => {
    if (!puzzleId || disabled || isRunning || isChecking) {
      return;
    }

    setIsChecking(true);
    setCheckMessage("");

    try {
      const checkResponse = await api.post(`/puzzles/${puzzleId}/interpreter/check`, {
        language,
        code,
        stdin
      });
      const checkResult = checkResponse.data;

      const candidate = checkResult?.candidate || {};
      setResult({
        stdout: candidate.stdout || "",
        stderr: candidate.stderr || "",
        exitCode: candidate.exitCode,
        timedOut: Boolean(candidate.timedOut),
        runtimeError: candidate.runtimeError || null
      });

      setCheckMessage(checkResult?.message || "Verification completed.");
    } catch (requestError) {
      setCheckMessage(requestError?.response?.data?.message || "Unable to run and check answer.");
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-700/40 bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Fix Code Workspace</h3>
        <div className="flex items-center gap-2">
          {enforcePython ? (
            <span className="rounded-md border border-slate-600 bg-slate-950 px-3 py-1 text-sm">Python</span>
          ) : (
            <select
              className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
              value={language}
              onChange={(event) => {
                const nextLanguage = event.target.value;
                setLanguage(nextLanguage);
                setCode(defaultSnippet(nextLanguage));
                setResult(null);
                setCheckMessage("");
              }}
              disabled={disabled || isRunning || isChecking}
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
            </select>
          )}
          <button
            type="button"
            className="rounded-md border border-emerald-400/70 px-3 py-1 text-sm"
            onClick={runSnippet}
            disabled={disabled || isRunning || isChecking || !code.trim()}
          >
            {isRunning ? "Running..." : "Run"}
          </button>
          {verifierEnabled ? (
            <button
              type="button"
              className="rounded-md border border-cyan-400/70 px-3 py-1 text-sm"
              onClick={runAndCheckAnswer}
              disabled={disabled || isRunning || isChecking || !code.trim()}
            >
              {isChecking ? "Checking..." : "Run + Verify"}
            </button>
          ) : null}
        </div>
      </div>

      <p className="mb-3 text-xs text-muted">
        Read-only puzzle code is on the left and your editable solution is on the right. Run executes your code.
        {verifierEnabled ? " Run + Verify compares output with the uploaded correct file." : ""}
      </p>

      {!interpreterEnabled ? (
        <p className="mb-3 text-xs text-amber-200">
          Interpreter is available by puzzle type/assets, but you can explicitly enable it via Builtin Tools: codeWorkspace or pythonInterpreter.
        </p>
      ) : null}

      {referenceAssets.length > 1 ? (
        <div className="mb-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted">Reference File</p>
          <select
            className="w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-sm"
            value={referenceAssetUrl}
            onChange={(event) => setReferenceAssetUrl(event.target.value)}
            disabled={disabled || isRunning || isChecking}
          >
            {referenceAssets.map((item) => (
              <option key={item.url} value={item.url}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-muted">Puzzle Source (Read Only)</p>
          <textarea
            className="h-52 w-full rounded-xl border border-slate-600 bg-slate-950/70 p-3 font-mono text-sm"
            value={
              referenceLoading
                ? "Loading reference file..."
                : referenceCode || "No participant-visible reference text/code file found in puzzle assets."
            }
            readOnly
            disabled
          />
        </div>

        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-muted">Your Code</p>
          <textarea
            className="h-52 w-full rounded-xl border border-slate-600 bg-slate-950/70 p-3 font-mono text-sm"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={disabled || isRunning || isChecking}
          />
          <p className="mb-1 text-xs uppercase tracking-wide text-muted">Standard Input</p>
          <textarea
            className="h-24 w-full rounded-xl border border-slate-600 bg-slate-950/70 p-3 font-mono text-sm"
            value={stdin}
            onChange={(event) => setStdin(event.target.value)}
            disabled={disabled || isRunning || isChecking}
          />

          <p className="mb-1 mt-3 text-xs uppercase tracking-wide text-muted">Output</p>
          <pre className="h-24 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-xs">
            {result?.stdout || "(no stdout)"}
          </pre>

          <p className="mb-1 mt-3 text-xs uppercase tracking-wide text-muted">Errors</p>
          <pre className="h-24 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-xs text-rose-200">
            {result?.runtimeError || result?.stderr || "(no errors)"}
          </pre>

          <p className="mt-2 text-xs text-muted">
            Exit code: {result?.exitCode ?? "-"} {result?.timedOut ? "| Timed out" : ""}
          </p>

          <p className="mt-2 text-xs text-cyan-200">{checkMessage || " "}</p>
        </div>
      </div>
    </section>
  );
}
