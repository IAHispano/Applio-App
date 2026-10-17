// Shared normalization for every release consumer. Build metadata is omitted
// because installer package formats do not consistently support it.
export function releaseVersion(input) {
  const version = (input || "").trim().replace(/^v/, "");
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
    version,
  );
  if (!match || match[4]?.split(".").some((part) => /^\d+$/.test(part) && /^0\d/.test(part)))
    throw new Error("Enter a release version such as 0.2.11 or 0.3.0-beta.1");
  return version;
}
