const reader = Deno.stdin.readable.getReader();

setTimeout(async () => {
  console.log(JSON.stringify({ phase: "cancel-start" }));
  try {
    await reader.cancel("fieldwork shutdown");
    console.log(JSON.stringify({ phase: "cancel-resolved" }));
  } catch (error) {
    console.log(JSON.stringify({
      phase: "cancel-rejected",
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    }));
  }
}, 100);

console.log(JSON.stringify({ phase: "read-start" }));
const result = await reader.read();
console.log(JSON.stringify({ phase: "read-resolved", result }));
reader.releaseLock();
console.log(JSON.stringify({ phase: "done" }));
