Deno.writeTextFileSync(new URL("./attempt.txt", import.meta.url), "attempted\n");
Deno.exit(1);
