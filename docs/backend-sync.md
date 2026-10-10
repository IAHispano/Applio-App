# One RVC backend

`backend/applio` is a pinned Git submodule of https://github.com/IAHispano/Applio.
The app loads RVC directly from this checkout. Root `core.py` is an app CLI
adapter; UVR code and dependencies stay in Applio-App.

## Development

```sh
git clone --recurse-submodules https://github.com/IAHispano/Applio-App.git
# For existing checkouts:
pnpm backend:init
pnpm backend:check
```

Make RVC changes in `backend/applio`, commit and push them to Applio, then
commit the updated submodule pin in Applio-App. To adopt newer main:

```sh
git -C backend/applio fetch origin main
git -C backend/applio checkout origin/main
git add backend/applio
pnpm backend:check
```

Builds reject missing, dirty, or mismatched engine revisions. CI initializes
submodules and bundles that exact source. Installed users need no Git.
App formatters exclude the backend. Engine formatting happens in Applio.

App `requirements.txt` includes `backend/applio/requirements-engine.txt` and
adds UVR and app integrations. Setup flattens includes before applying ROCm
or legacy NVIDIA adjustments. Applio installs no UVR dependencies.

`APPLIO_BACKEND_ROOT` selects engine code for development. `APPLIO_CODE_ROOT`
selects interface resources, `APPLIO_ROOT` selects writable data, and
`APPLIO_LOGS_DIR` selects training storage. Backend imports take precedence
over legacy cached code. Downloaded weights stay outside the submodule.
