import { performance } from "node:perf_hooks";

const DEFAULTS = {
  baseUrl: "http://localhost:4100",
  users: 40,
  rounds: 20,
  delayMs: 250,
  teamCode: "TEAM01",
  teamName: "Quantum Foxes"
};

const ENDPOINTS = ["/event/state", "/progress", "/puzzles", "/clipboard", "/leaderboard"];

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === "--help" || key === "-h") {
      options.help = true;
      break;
    }

    if (key === "--baseUrl" && value) {
      options.baseUrl = value;
      index += 1;
      continue;
    }

    if (key === "--users" && value) {
      options.users = Number(value);
      index += 1;
      continue;
    }

    if (key === "--rounds" && value) {
      options.rounds = Number(value);
      index += 1;
      continue;
    }

    if (key === "--delayMs" && value) {
      options.delayMs = Number(value);
      index += 1;
      continue;
    }

    if (key === "--teamCode" && value) {
      options.teamCode = value;
      index += 1;
      continue;
    }

    if (key === "--teamName" && value) {
      options.teamName = value;
      index += 1;
      continue;
    }
  }

  options.baseUrl = `${options.baseUrl}`.replace(/\/+$/, "");
  options.users = Number.isFinite(options.users) ? Math.max(1, Math.floor(options.users)) : DEFAULTS.users;
  options.rounds = Number.isFinite(options.rounds) ? Math.max(1, Math.floor(options.rounds)) : DEFAULTS.rounds;
  options.delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.floor(options.delayMs)) : DEFAULTS.delayMs;

  return options;
}

function printHelp() {
  console.log("Usage: npm run loadtest -- - optional flags");
  console.log("Flags:");
  console.log("  --baseUrl   API base URL (default: http://localhost:4100)");
  console.log("  --users     Number of concurrent virtual users (default: 40)");
  console.log("  --rounds    Number of request rounds per user (default: 20)");
  console.log("  --delayMs   Delay between rounds in ms (default: 250)");
  console.log("  --teamCode  Team code used for session login (default: TEAM01)");
  console.log("  --teamName  Team name used for session login (default: Quantum Foxes)");
}

async function sleep(ms) {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const clamped = Math.min(100, Math.max(0, percentileValue));
  const position = Math.ceil((clamped / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, position)];
}

async function timedFetch(url, requestInit) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, requestInit);
    const endedAt = performance.now();
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: endedAt - startedAt,
      error: null
    };
  } catch (error) {
    const endedAt = performance.now();
    return {
      ok: false,
      status: 0,
      latencyMs: endedAt - startedAt,
      error: error instanceof Error ? error.message : "unknown network error"
    };
  }
}

async function loginAndGetCookie({ baseUrl, teamCode, teamName }) {
  const response = await fetch(`${baseUrl}/auth/team-session`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ teamCode, teamName })
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Login failed (${response.status}): ${bodyText}`);
  }

  const rawSetCookie = response.headers.get("set-cookie");
  if (!rawSetCookie) {
    throw new Error("Login succeeded but no set-cookie header was returned.");
  }

  const cookie = rawSetCookie.split(";")[0];
  if (!cookie) {
    throw new Error("Could not extract session cookie from set-cookie header.");
  }

  return cookie;
}

async function runRound({ baseUrl, cookie }) {
  const outcomes = [];
  for (const endpoint of ENDPOINTS) {
    const outcome = await timedFetch(`${baseUrl}${endpoint}`, {
      method: "GET",
      headers: {
        cookie
      }
    });
    outcomes.push({ endpoint, ...outcome });
  }
  return outcomes;
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is unavailable. Use Node.js 18+ to run this load test.");
  }

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  console.log("Running API load test...");
  console.log(`Base URL: ${options.baseUrl}`);
  console.log(`Virtual users: ${options.users}`);
  console.log(`Rounds per user: ${options.rounds}`);
  console.log(`Endpoints per round: ${ENDPOINTS.length}`);

  const cookies = await Promise.all(
    Array.from({ length: options.users }).map(() =>
      loginAndGetCookie({
        baseUrl: options.baseUrl,
        teamCode: options.teamCode,
        teamName: options.teamName
      })
    )
  );

  const latencies = [];
  const failedRequests = [];
  const statusCount = new Map();

  const startedAt = performance.now();
  for (let round = 1; round <= options.rounds; round += 1) {
    const roundOutcomes = await Promise.all(
      cookies.map((cookie) =>
        runRound({
          baseUrl: options.baseUrl,
          cookie
        })
      )
    );

    for (const userOutcomes of roundOutcomes) {
      for (const outcome of userOutcomes) {
        latencies.push(outcome.latencyMs);
        const key = `${outcome.status}`;
        statusCount.set(key, (statusCount.get(key) || 0) + 1);
        if (!outcome.ok) {
          failedRequests.push(outcome);
        }
      }
    }

    process.stdout.write(`Completed round ${round}/${options.rounds}\r`);
    await sleep(options.delayMs);
  }
  process.stdout.write("\n");
  const endedAt = performance.now();

  const totalRequests = options.users * options.rounds * ENDPOINTS.length;
  const durationSeconds = Math.max(0.001, (endedAt - startedAt) / 1000);
  const sortedLatencies = [...latencies].sort((left, right) => left - right);

  const avgLatency = latencies.reduce((sum, value) => sum + value, 0) / Math.max(1, latencies.length);
  const p50 = percentile(sortedLatencies, 50);
  const p95 = percentile(sortedLatencies, 95);
  const p99 = percentile(sortedLatencies, 99);
  const successRequests = totalRequests - failedRequests.length;

  console.log("Load test summary");
  console.log(`Total requests: ${totalRequests}`);
  console.log(`Successful requests: ${successRequests}`);
  console.log(`Failed requests: ${failedRequests.length}`);
  console.log(`Duration: ${durationSeconds.toFixed(2)}s`);
  console.log(`Throughput: ${(totalRequests / durationSeconds).toFixed(2)} req/s`);
  console.log(`Latency avg: ${avgLatency.toFixed(2)} ms`);
  console.log(`Latency p50: ${p50.toFixed(2)} ms`);
  console.log(`Latency p95: ${p95.toFixed(2)} ms`);
  console.log(`Latency p99: ${p99.toFixed(2)} ms`);

  const statusSummary = [...statusCount.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([status, count]) => `${status}:${count}`)
    .join(" ");
  console.log(`HTTP status distribution: ${statusSummary || "none"}`);

  if (failedRequests.length > 0) {
    const sample = failedRequests.slice(0, 10);
    console.log("Sample failures (first 10):");
    sample.forEach((failure, index) => {
      console.log(
        `${index + 1}. endpoint=${failure.endpoint} status=${failure.status} error=${failure.error || "n/a"}`
      );
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Load test failed:", error.message || error);
  process.exit(1);
});
