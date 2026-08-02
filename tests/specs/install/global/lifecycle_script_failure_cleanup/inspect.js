const exists = (path) => {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
};

console.log(JSON.stringify({
  config: exists("root/bin/.print-npm-user-agent"),
  shim: exists("root/bin/print-npm-user-agent") ||
    exists("root/bin/print-npm-user-agent.cmd"),
}));
