# Reference installer: static investigation

The operator supplied `PS4_FLTZ00003_v1.02.pkg` after receiver 0.11 failed
to launch. No reference binary or extracted asset is included in this repository.

## Artifact identity and limits

- PKG: 4,259,840 bytes, SHA-256
  `5a940daa69d04ac3286d42903df0547846b641e6f4d3f6b02b605828990f9b3c`.
- Extracted SELF: SHA-256
  `fea6b59a74d96d38bae5468157eec2dbf1603d60c2299e37270084a1ebeee567`.
- The supplied filename says v1.02; its SFO reports APP_VER/VERSION `01.00`.
  Filename alone does not establish its internal version or source revision.
- REA rejected the PS4 PKG container and its direct SELF image. PkgTool
  extracted it locally. Uncompressed SELF segments were reconstructed at their
  ELF offsets; an analysis-only section table was appended for disassembly.
  The original package and SELF were preserved. The derived ELF SHA-256 is
  `e89a970b0a60b2de0f0df7060494473f1b1f094ebbd444e824bc4ecce1eda671`.
- REA `inspect_with_objdump(disassemble_all)` completed, exit 0, no truncation,
  with Evidence `ev_1574753236038b99d31370f4a2e46cbe9c440fe9efb50db3764310b33c9b3569`.
  This is assembly for a derived image, not recovered source or runtime evidence.
  Embedded data in the executable segment also appears as decoded instructions;
  conclusions below use the focused call sequence rather than arbitrary output.
- Ghidra, Hopper and IDA were unavailable in the connected REA session. No
  decompiler or client configuration was installed or changed. Complete evidence,
  extraction and derivation records remain in the private analysis directory.

## Observations

At virtual offsets `0x1082` through `0x1130`, the reference calls the same
module-loading stub with IDs for SYSCORE, SYSTEM_SERVICE, USER_SERVICE, NETCTL,
NET, HTTP, SSL, APPINSTUTIL, BGFT and NP_COMMON. Return values are checked and
branch into cleanup on failure. BGFT and AppInstUtil are present in its declared
PRX dependencies, so their mere presence does not establish the cause of our
launch error. Our 0.11 change removing them did not resolve it on the console.

The derived image contains API route strings including `/api/install`,
`/api/is_exists`, `/api/get_task_progress`, and task start/stop/pause/resume.
Their presence establishes route names, not that every route was exercised.
The existing Mac client can retain compatibility with the common API subset.

## What we can use

Use the reference's checked module initialization order, cleanup discipline,
and API compatibility as behavioral guidance for our independent implementation.
Review HTTP/SSL/NP_COMMON initialization when validating BGFT transfers. Keep
progress and speed based on native counters and measured elapsed time. Native
pause/resume can be investigated after a successful base transfer; a route name
alone is insufficient to implement or promise the behavior.

Do not transplant the executable, proprietary runtime, images or package identity
into our app. The reference has a different SDK/runtime and SFO profile; copying
individual values without testing would not establish compatibility.

## Current result and next controlled test

The console log for our SFO version 0.11 again records
`0xa0020102 (PRX_SCE_MODULE_LOAD_ERROR)`. The specific missing module and whether
our `main` was reached remain unknown. Receiver 0.12 adds kernel-log markers at
entry to main, before/after each module load, service initialization and video
initialization. This is a diagnostic build, not a claimed fix. It must be launched
on the console and its new markers inspected before changing more components.
