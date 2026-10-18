# Security Policy

This policy covers [Applio Desktop](https://github.com/IAHispano/Applio-App),
including its desktop shell, native API, Bridge Mode, file handling, and updater.

## Supported versions

Security fixes target the latest stable release. Older releases do not receive
separate security backports. Please update before checking whether a problem
still occurs. Development builds and prereleases may receive fixes, but are not
a substitute for a supported stable release.

## Report a vulnerability privately

**Do not disclose vulnerabilities in public issues, pull requests, or Discord
channels, including #applio-app-testers.** Use public bug reports for ordinary
functional problems that do not expose a security vulnerability.

If the repository's [Security tab](https://github.com/IAHispano/Applio-App/security)
offers **Report a vulnerability**, use it to submit a private report.

Otherwise, join the [official Applio Discord](https://discord.gg/wY7gmqTyEV)
and ask a maintainer how to arrange a private security report. Your initial
request should only say that you need a private reporting channel; share the
technical details after a private conversation has been established.

Include the following when sharing your report privately:

- A summary of the vulnerability, its impact, and who could exploit it.
- The affected Applio version, engine revision if available, operating system,
  architecture, and installation method.
- Clear reproduction steps, required settings or access, and a minimal proof
  of concept. Explain whether the attack works with default settings.
- Relevant logs or screenshots with credentials, invite links, personal audio,
  and other sensitive information removed.
- Any suggested mitigation or fix, if you have one.

For desktop API or Bridge Mode issues, explain whether exploitation requires
local access, a malicious website, network access, or an authorized Bridge
session. For model, plugin, or file issues, identify the required user actions.
Do not include a live malicious payload in a public upload.

## Coordinated disclosure

Maintainers will review reports and may request more information. Fixes and
disclosure timing depend on severity, reproducibility, and available resources;
there is no guaranteed response or resolution deadline.

Please coordinate public disclosure with maintainers so affected users can
receive a fix or mitigation first. Any reporter credit will be agreed with you
before publication. No financial reward is promised for vulnerability reports.

## Responsible testing

Test only on systems and data you own or have explicit permission to use.
Keep demonstrations minimal and avoid disrupting services, accessing another
person's data, or publishing credentials or working exploit details.

Models, plugins, and dependencies can execute code or process untrusted files.
Only install content from sources you trust. Keep the local API restricted to
loopback, and share Bridge access only with people you authorize.
