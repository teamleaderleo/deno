const mode = Deno.args[0];
const port = Number(Deno.env.get("FIELDWORK_PORT") ?? "19371");
const hostname = Deno.env.get("FIELDWORK_HOST") ?? "dualstack-fieldwork.test";
const timeoutMs = Number(Deno.env.get("FIELDWORK_TIMEOUT_MS") ?? "2000");

if (mode !== "connect-race" && mode !== "response-stall") {
  console.error("usage: probe.ts connect-race|response-stall");
  Deno.exit(2);
}

let ipv4Requests = 0;
const ipv4Server = Deno.serve(
  {
    hostname: "127.0.0.1",
    port,
    onListen() {},
  },
  () => {
    ipv4Requests++;
    return new Response("ipv4-ok");
  },
);

let ipv6Accepts = 0;
let ipv6Listener: Deno.TcpListener | undefined;
const ipv6Connections: Deno.Conn[] = [];
let acceptLoop: Promise<void> | undefined;

if (mode === "response-stall") {
  ipv6Listener = Deno.listen({ hostname: "::1", port, transport: "tcp" });
  acceptLoop = (async () => {
    try {
      for await (const connection of ipv6Listener!) {
        ipv6Accepts++;
        ipv6Connections.push(connection);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.BadResource)) {
        throw error;
      }
    }
  })();
}

await new Promise((resolve) => setTimeout(resolve, 100));

const started = performance.now();
let status: number | null = null;
let body: string | null = null;
let errorName: string | null = null;
let errorMessage: string | null = null;

try {
  const response = await fetch(`http://${hostname}:${port}/`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  status = response.status;
  body = await response.text();
} catch (error) {
  errorName = error instanceof Error ? error.name : typeof error;
  errorMessage = error instanceof Error ? error.message : String(error);
}

const elapsedMs = Math.round(performance.now() - started);

for (const connection of ipv6Connections) {
  try {
    connection.close();
  } catch {
    // Already closed.
  }
}
if (ipv6Listener) {
  ipv6Listener.close();
}
if (acceptLoop) {
  await acceptLoop;
}
await ipv4Server.shutdown();

const result = {
  mode,
  hostname,
  port,
  timeoutMs,
  elapsedMs,
  status,
  body,
  errorName,
  errorMessage,
  ipv4Requests,
  ipv6Accepts,
};
console.log(JSON.stringify(result));

if (mode === "connect-race") {
  if (status !== 200 || body !== "ipv4-ok" || ipv4Requests !== 1) {
    console.error("connect-level IPv6 stall did not fall back to IPv4");
    Deno.exit(1);
  }
  if (elapsedMs >= timeoutMs) {
    console.error("connect-level fallback consumed the full request timeout");
    Deno.exit(1);
  }
} else {
  if (ipv6Accepts < 1) {
    console.error("response-stall control did not select the IPv6 connection");
    Deno.exit(1);
  }
  if (status !== null || errorName === null || ipv4Requests !== 0) {
    console.error("accepted IPv6 response stall unexpectedly retried through IPv4");
    Deno.exit(1);
  }
}
