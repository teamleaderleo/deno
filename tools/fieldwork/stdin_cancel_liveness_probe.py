#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import tempfile
import time


def read_text(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return ""


def wait_for_marker(process: subprocess.Popen[bytes], path: pathlib.Path, marker: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if marker in read_text(path):
            return True
        if process.poll() is not None:
            return marker in read_text(path)
        time.sleep(0.05)
    return marker in read_text(path)


def terminate(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=2)


def open_pipe_case(deno: str, script: pathlib.Path, root: pathlib.Path) -> dict[str, object]:
    stdout_path = root / "open-pipe.stdout"
    stderr_path = root / "open-pipe.stderr"
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        process = subprocess.Popen(
            [deno, "run", "--strace-ops", str(script)],
            stdin=subprocess.PIPE,
            stdout=stdout,
            stderr=stderr,
        )
        try:
            done_observed = wait_for_marker(process, stdout_path, '"phase":"done"', 4)
            if not done_observed:
                raise RuntimeError("JavaScript did not reach the done phase")

            time.sleep(0.4)
            alive_after_done = process.poll() is None
            woke_after_byte = None
            if alive_after_done:
                assert process.stdin is not None
                process.stdin.write(b"x\n")
                process.stdin.flush()
                try:
                    process.wait(timeout=3)
                    woke_after_byte = True
                except subprocess.TimeoutExpired:
                    woke_after_byte = False
                    raise RuntimeError("process stayed alive after the wakeup byte")
            returncode = process.wait(timeout=1) if process.poll() is None else process.returncode
        finally:
            if process.stdin is not None:
                process.stdin.close()
            terminate(process)

    return {
        "done_observed": done_observed,
        "alive_after_done": alive_after_done,
        "woke_after_byte": woke_after_byte,
        "returncode": returncode,
        "stdout": read_text(stdout_path),
        "stderr": read_text(stderr_path),
    }


def eof_case(deno: str, script: pathlib.Path, root: pathlib.Path) -> dict[str, object]:
    stdout_path = root / "eof.stdout"
    stderr_path = root / "eof.stderr"
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        process = subprocess.Popen(
            [deno, "run", "--strace-ops", str(script)],
            stdin=subprocess.DEVNULL,
            stdout=stdout,
            stderr=stderr,
        )
        try:
            returncode = process.wait(timeout=4)
        except subprocess.TimeoutExpired as error:
            terminate(process)
            raise RuntimeError("EOF control did not exit") from error

    output = read_text(stdout_path)
    if '"phase":"done"' not in output:
        raise RuntimeError("EOF control did not reach done")
    return {
        "returncode": returncode,
        "stdout": output,
        "stderr": read_text(stderr_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deno", default="deno")
    parser.add_argument("--script", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="deno-stdin-cancel-") as temporary:
        root = pathlib.Path(temporary)
        version = subprocess.run(
            [args.deno, "--version"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        ).stdout
        record = {
            "version": version,
            "open_pipe": open_pipe_case(args.deno, args.script, root),
            "eof": eof_case(args.deno, args.script, root),
        }

    args.output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(record, sort_keys=True))


if __name__ == "__main__":
    main()
