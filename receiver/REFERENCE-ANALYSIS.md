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

## Follow-up: required OpenOrbis runtime modules (0.13)

The 0.12 launch still reports the same PRX error, with no `[PKGA 0.12]` entry
marker in the collected kernel log. Missing markers do not independently prove
control flow, but this narrows the investigation to startup and logging setup.
The package build omitted `sce_module/libc.prx` and
`sce_module/libSceFios2.prx`. The bundled SDK samples include both. The official
[OpenOrbis source documentation](https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain/blob/master/src/README.md)
explicitly says these empty replacement modules are needed in packages.
These are OpenOrbis replacements, not modules copied from the reference app.

Build 0.13 stages both modules from the supplied SDK, rejects missing/invalid
module files and records their hashes. Two packaging regression tests and the
native protocol/model test passed. A fresh extraction of the built receiver PKG
confirmed both embedded module hashes match the SDK sources. Both the receiver
and harmless probe were rebuilt; earlier probes also lacked these modules and
must not be used for the next console test. The packaging omission is confirmed;
whether it is the only launch problem still requires hardware validation.

The operator subsequently confirmed 0.13 opens. Its live health endpoint returned
version `0.1.3`, `ready:false`; the protected operation reported
`MODULO 80020002`. Thus launch and networking work, but installing is not ready.
The dynamic module paths introduced in 0.11 used `/system/common/lib`, which is
not the application's sandbox path. Version 0.14 builds the path using
`sceKernelGetFsSandboxRandomWord()` as the SDK Piglet sample does, checks bounds,
and keeps failures explicit. It also formats kernel trace messages before
calling DebugOutText: the collected 0.13 log contained literal format placeholders.
No probe was sent while health reported false. Runtime readiness and transfer
still require a new hardware test.

The old RPI refused the 0.14 replacement with `0x80990015`. The console log
identified it as `SCE_BGFT_ERROR_SAME_APPLICATION_ALREADY_INSTALLED`, not an
incomplete transfer. To preserve the installed receiver, `--alternate-receiver`
builds a distinct `PKGA00003` named `PS4 Package Assistant - Teste 0.14`.
That title was absent before sending; task 355 completed without error and a
read-only hash of its installed package matched the generated package.
Its launch/readiness remains pending. Neither existing receiver was removed.

The operator opened 0.14; health returned `0.1.4`, `ready:false` and the
operation error changed to `MODULO 80020008`. Kernel traces now show main and
every module ID/result. AppInstUtil fails both the internal-module load and
direct load. The loader explicitly records auth rejection `800f0d39` for caller
`3800000000000011` and module `3900000000000002`. This is a permission failure,
not the previous missing-path error. No install was attempted by this receiver.

Reading the supplied working SELF's extended info shows authority ID
`3100000000000002`; ours used the SDK sample's `3800000000000011`. The reference
SFO also uses `CATEGORY=gde`, `ATTRIBUTE=0x12`; its runtime log identifies it as
a system mini-app. Receiver build 0.15 tests that observed authority/category
profile. The harmless probe keeps its ordinary application profile. Reports now
record these profile fields. This is a testable compatibility hypothesis, not
proof that all service permissions or BGFT transfers work. The separate 0.15
test identity is PKGA00004; existing test applications remain intact.

On 0.15, kernel markers again show startup and AppInstUtil rejection, now
explicitly for caller `3100000000000002`; changing that identifier and the SFO
was insufficient. There was no HTTP listener at the time of the follow-up.

The reference's fake-SELF signature area additionally contains a 136-byte
authentication/capability record, whereas our 0.15 signature area is zero-filled.
The SDK's create-fself `--authinfo` option serializes this record. Build 0.16
supplies the observed public capability fields for the receiver, retaining the
ordinary probe profile. These are flags in a fake-SELF header, not a signing key,
credential, or copied executable. Direct readback of the built SELF confirmed
all 136 expected bytes, SHA-256
`4a34b683efe03431051c361989ed5855b759f8e2013fa65330c414f214bdf679`.
The build report records that digest. Tests and package validation passed;
runtime authorization is still unverified. Separate 0.16 identity: PKGA00005.
