# Global install lifecycle failure ownership

Source revision: `3ee245fe9da563cacb0b6458c4280b5a2758782c`

Public report: [failed global lifecycle install leaves partial state](https://redirect.github.com/denoland/deno/issues/36334)

Upstream contact performed: `false`

## Current source order

`install_global()` currently:

1. resolves the command name and installation directory;
2. calls `setup_config_dir()`;
3. `setup_config_dir()` immediately creates `bin/.<name>`;
4. it writes generated config and package metadata into that directory;
5. it runs `install_from_entrypoints()`, including allowed npm lifecycle scripts;
6. only after that succeeds does `install_global()` publish the command shim.

A lifecycle-script failure therefore occurs after the hidden command directory exists and before the public shim exists.

The retained directory is not a harmless cache entry. On a later attempt it can change package initialization and lifecycle-script decisions, allowing retry behavior to diverge from the first attempt.

## Desired invariant

For a command without an existing published shim, a failed global install must leave no command-owned config directory and no shim.

A retry after failure must execute the same enabled lifecycle scripts again. It must not treat a retained partial directory as completed installation state.

Existing successful installations are a separate replacement/upgrade case. This first repair should avoid deleting a previously published command merely because an attempted update fails.

## Added characterization

`tests/specs/install/global/lifecycle_script_failure_cleanup` uses the existing `@denotest/print-npm-user-agent@1.0.0` fixture, whose postinstall script always exits with status 1.

The test requires:

- first install fails;
- the hidden config directory and shim are absent afterward;
- the second identical install also runs the lifecycle script and fails.

This test is expected to fail on the pinned source until cleanup ownership is repaired.

## Candidate repair direction

The narrow first candidate should:

1. record whether the primary shim existed before setup;
2. remove a stale hidden command directory before a fresh install when no shim exists;
3. run setup and lifecycle scripts;
4. on setup failure, remove the command directory only when there was no pre-existing shim;
5. preserve the original lifecycle error if cleanup also fails, while reporting the cleanup failure separately.

This repairs fresh and previously interrupted installs without claiming transactional safety for updates over an existing command.

A later change may stage a complete replacement directory and swap it into place only after successful lifecycle execution. That broader transaction needs explicit Windows rename/replacement tests and should remain separate from this first regression.

## Draft upstream summary

A failed enabled lifecycle script during global installation currently leaves the per-command hidden directory behind before the command shim is published. A later retry can then observe the retained package state and skip the script that failed previously.

The proposed first repair cleans command-owned setup state when no prior command shim existed, and adds a two-attempt regression using the repository's failing lifecycle fixture. Existing published commands remain outside the cleanup path so an unsuccessful update does not delete the prior installation.

## Validation still required

- run the focused spec before and after the candidate;
- run global-install integration tests on Unix and Windows;
- confirm an existing successful command survives a failed forced replacement;
- confirm cleanup failure does not replace the original lifecycle error;
- inspect whether package cache state outside `bin/.<name>` also affects retry.
